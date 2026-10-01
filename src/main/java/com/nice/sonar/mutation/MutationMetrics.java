package com.nice.sonar.mutation;

import java.util.List;
import org.sonar.api.measures.CoreMetrics;
import org.sonar.api.measures.Metric;
import org.sonar.api.measures.Metrics;

/** Spike metrics: the gate metric and its new-code twin. */
public class MutationMetrics implements Metrics {

  public static final String DOMAIN = "Mutation";

  public static final Metric<Double> MUTATION_SCORE = new Metric.Builder(
      "mutation_score", "Mutation Score", Metric.ValueType.PERCENT)
      .setDescription("Share of mutants killed by tests, as reported by the mutation agent")
      .setDirection(Metric.DIRECTION_BETTER)
      .setQualitative(true)
      .setBestValue(100.0)
      .setWorstValue(0.0)
      .setDomain(DOMAIN)
      .create();

  public static final Metric<Double> NEW_MUTATION_SCORE = new Metric.Builder(
      "new_mutation_score", "Mutation Score on New Code", Metric.ValueType.PERCENT)
      .setDescription("Mutation score of the changed lines, as reported by the mutation agent")
      .setDirection(Metric.DIRECTION_BETTER)
      .setQualitative(true)
      .setBestValue(100.0)
      .setWorstValue(0.0)
      .setDomain(DOMAIN)
      .create();

  @Override
  public List<Metric> getMetrics() {
    return List.of(MUTATION_SCORE, NEW_MUTATION_SCORE);
  }
}
