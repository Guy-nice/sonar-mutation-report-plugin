package com.nice.sonar.mutation;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import org.sonar.api.measures.Metric;
import org.sonar.api.measures.Metrics;

/**
 * Metric catalog. Mirrors what the DevCon5 mutation plugin showed (counts, score, test strength,
 * density, hotspots, test-level data) but language-agnostic, under {@code mutation_*} keys, and with a
 * {@code new_mutation_*} variant of every metric so quality gates can judge a pull request's own code.
 */
public class MutationMetrics implements Metrics {

  public static final String DOMAIN = "Mutation Analysis";

  /** Languages with their own project-level measures; everything else lands in "other". */
  public static final List<String> LANGUAGES =
      List.of("csharp", "typescript", "javascript", "java", "python", "go", "other");
  /** Per-language measures: score, total, killed, survived. */
  public static final List<String> LANGUAGE_FIELDS = List.of("score", "total", "killed", "survived");

  public enum Scope {
    OVERALL(""), NEW("new_");

    public final String prefix;

    Scope(String prefix) {
      this.prefix = prefix;
    }
  }

  /** One logical metric. {@code additive} counts are summed up the tree; the rest are derived. */
  public enum Base {
    // additive counts
    TOTAL("total", "Mutations: Total", Metric.ValueType.INT, 0, true, "Total number of mutations generated"),
    KILLED("killed", "Killed: by Tests", Metric.ValueType.INT, 1, true, "Number of mutations killed by tests"),
    TIMED_OUT("timed_out", "Killed: by Timeout", Metric.ValueType.INT, 1, true, "Number of mutations detected by time outs"),
    MEMORY_ERROR("memory_error", "Killed: by Memory Error", Metric.ValueType.INT, 1, true, "Number of mutations detected by memory errors"),
    KILLED_TOTAL("killed_total", "Killed: Total", Metric.ValueType.INT, 1, true, "Mutations killed by a test, a timeout or a memory error"),
    SURVIVED("survived", "Alive: Survivors", Metric.ValueType.INT, -1, true, "Number of mutations that survived the tests"),
    NO_COVERAGE("no_coverage", "Alive: Not Covered", Metric.ValueType.INT, -1, true, "Number of mutations not covered by any test"),
    ALIVE("alive", "Alive: Total", Metric.ValueType.INT, -1, true, "Mutations still alive, covered and not covered"),
    UNKNOWN("unknown", "Unknown Status", Metric.ValueType.INT, -1, true, "Number of mutations with unknown status"),
    SUPPRESSED("suppressed", "Suppressed (equivalent)", Metric.ValueType.INT, 0, true, "Mutants excluded as equivalent or on non-executable lines"),
    TESTS_EXECUTED("tests_executed", "Test: Executions", Metric.ValueType.INT, 0, true, "Number of test executions during mutation testing"),
    TEST_KILLS("test_kills", "Test: Kills", Metric.ValueType.INT, 1, true, "Mutations killed, counted per killing test"),
    // utility, hidden
    LINES("lines", "Utility: Analyzable Lines", Metric.ValueType.INT, 0, true, "Analyzable lines, used for density"),
    GLOBAL_TOTAL("global_total", "Utility: Total Mutations Global", Metric.ValueType.INT, 0, false, "Project-wide mutation count, used for hotspot shares"),
    GLOBAL_ALIVE("global_alive", "Utility: Total Survivors Global", Metric.ValueType.INT, 0, false, "Project-wide alive count, used for hotspot shares"),
    // derived percentages
    SCORE("score", "Mutation: Score", Metric.ValueType.PERCENT, 1, false, "Share of mutants killed by tests (the gate metric)"),
    TEST_STRENGTH("test_strength", "Test Strength", Metric.ValueType.PERCENT, 1, false, "Killed / (killed + survived); ignores mutants no test reaches"),
    DENSITY("density", "Mutation: Density", Metric.ValueType.PERCENT, 0, false, "Mutations per analyzable line, in percent (not DevCon5's per-statement value)"),
    ALIVE_PERCENT("alive_percent", "Alive: Total %", Metric.ValueType.PERCENT, -1, false, "Share of all project survivors found in this component"),
    TOTAL_PERCENT("total_percent", "Mutations: Total %", Metric.ValueType.PERCENT, -1, false, "Share of all project mutations found in this component"),
    TEST_KILL_RATIO("test_kill_ratio", "Test: Kill Ratio", Metric.ValueType.PERCENT, 1, false, "Kills per test execution");

    public final String suffix;
    public final String name;
    public final Metric.ValueType type;
    /** Metric.DIRECTION_*: 1 better, -1 worse, 0 none. */
    public final int direction;
    public final boolean additive;
    public final String description;

    Base(String suffix, String name, Metric.ValueType type, int direction, boolean additive, String description) {
      this.suffix = suffix;
      this.name = name;
      this.type = type;
      this.direction = direction;
      this.additive = additive;
      this.description = description;
    }

    public boolean isHidden() {
      return this == LINES || this == GLOBAL_TOTAL || this == GLOBAL_ALIVE;
    }

    public boolean isPercent() {
      return type == Metric.ValueType.PERCENT;
    }

    public String key(Scope scope) {
      return scope.prefix + "mutation_" + suffix;
    }
  }

  public static String languageKey(String language, String field, Scope scope) {
    return scope.prefix + "mutation_" + language + "_" + field;
  }

  public static String thresholdKey() {
    return "mutation_threshold";
  }

  /** The language bucket a report language falls into. */
  public static String bucket(String language) {
    String l = language == null ? "" : language.toLowerCase(Locale.ROOT);
    return LANGUAGES.contains(l) ? l : "other";
  }

  @SuppressWarnings({"rawtypes", "unchecked"})
  private static Metric build(String key, String name, Metric.ValueType type, int direction, String description,
      boolean hidden) {
    Metric.Builder b = new Metric.Builder(key, name, type)
        .setDescription(description)
        .setDirection(direction)
        .setDomain(DOMAIN)
        .setHidden(hidden);
    if (type == Metric.ValueType.PERCENT && direction != 0) {
      b.setQualitative(direction == 1).setBestValue(direction == -1 ? 0.0 : 100.0)
          .setWorstValue(direction == -1 ? 100.0 : 0.0);
    }
    if (type == Metric.ValueType.PERCENT) {
      b.setDecimalScale(1);
    }
    return b.create();
  }

  @SuppressWarnings("rawtypes")
  @Override
  public List<Metric> getMetrics() {
    List<Metric> all = new ArrayList<>();
    for (Scope scope : Scope.values()) {
      String label = scope == Scope.NEW ? " (new code)" : "";
      for (Base base : Base.values()) {
        all.add(build(base.key(scope), base.name + label, base.type, base.direction, base.description, base.isHidden()));
      }
      for (String lang : LANGUAGES) {
        for (String field : LANGUAGE_FIELDS) {
          boolean percent = field.equals("score");
          all.add(build(languageKey(lang, field, scope),
              "Mutation " + capitalize(field) + " (" + lang + ")" + label,
              percent ? Metric.ValueType.PERCENT : Metric.ValueType.INT,
              field.equals("survived") ? -1 : (field.equals("total") ? 0 : 1),
              "Mutation " + field + " for " + lang + " files", false));
        }
      }
    }
    all.add(build(thresholdKey(), "Mutation: Threshold", Metric.ValueType.PERCENT, 0,
        "Threshold the mutation agent used for its own gate (informational)", false));
    return all;
  }

  private static String capitalize(String s) {
    return s.substring(0, 1).toUpperCase(Locale.ROOT) + s.substring(1);
  }
}
