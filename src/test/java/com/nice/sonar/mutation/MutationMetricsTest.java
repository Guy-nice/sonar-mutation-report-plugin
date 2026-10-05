package com.nice.sonar.mutation;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.sonar.api.measures.Metric;

@SuppressWarnings("rawtypes")
class MutationMetricsTest {

  private final List<Metric> metrics = new MutationMetrics().getMetrics();

  @Test
  void keysAreUniqueAndValid() {
    Set<String> seen = new HashSet<>();
    for (Metric m : metrics) {
      assertThat(m.getKey()).matches("[a-z0-9_]{1,64}");
      assertThat(seen.add(m.getKey())).as("duplicate key " + m.getKey()).isTrue();
    }
  }

  @Test
  void everyBaseMetricHasAnOverallAndANewCodeVariant() {
    Set<String> keys = new HashSet<>();
    metrics.forEach(m -> keys.add(m.getKey()));
    for (MutationMetrics.Base base : MutationMetrics.Base.values()) {
      assertThat(keys).contains("mutation_" + base.suffix, "new_mutation_" + base.suffix);
    }
  }

  @Test
  void keepsTheKeysTheSpikeAlreadyProved() {
    Set<String> keys = new HashSet<>();
    metrics.forEach(m -> keys.add(m.getKey()));
    assertThat(keys).contains("mutation_score", "new_mutation_score");
  }

  @Test
  void everyLanguageHasScoreTotalKilledSurvivedInBothScopes() {
    Set<String> keys = new HashSet<>();
    metrics.forEach(m -> keys.add(m.getKey()));
    for (String lang : MutationMetrics.LANGUAGES) {
      for (String field : MutationMetrics.LANGUAGE_FIELDS) {
        assertThat(keys).contains("mutation_" + lang + "_" + field, "new_mutation_" + lang + "_" + field);
      }
    }
  }

  @Test
  void helperMetricsAreHiddenAndPublicOnesAreNot() {
    for (Metric m : metrics) {
      boolean helper = m.getKey().endsWith("_lines") || m.getKey().endsWith("_global_total")
          || m.getKey().endsWith("_global_alive");
      assertThat(m.isHidden()).as(m.getKey()).isEqualTo(helper);
    }
  }

  @Test
  void theGateMetricIsAHigherIsBetterPercentage() {
    Metric score = metrics.stream().filter(m -> m.getKey().equals("mutation_score")).findFirst().orElseThrow();
    assertThat(score.getType()).isEqualTo(Metric.ValueType.PERCENT);
    assertThat(score.getDirection()).isEqualTo(Metric.DIRECTION_BETTER);
    assertThat(score.getBestValue()).isEqualTo(100.0);
    assertThat(score.getWorstValue()).isEqualTo(0.0);
    assertThat(score.getDomain()).isEqualTo("Mutation Analysis");
  }

  @Test
  void languageBucketsFallBackToOther() {
    assertThat(MutationMetrics.bucket("TypeScript")).isEqualTo("typescript");
    assertThat(MutationMetrics.bucket("cobol")).isEqualTo("other");
    assertThat(MutationMetrics.bucket(null)).isEqualTo("other");
  }
}
