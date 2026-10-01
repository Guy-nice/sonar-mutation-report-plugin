package com.nice.sonar.mutation;

import java.util.ArrayList;
import java.util.List;
import org.sonar.api.ce.measure.Measure;
import org.sonar.api.ce.measure.MeasureComputer;

/** Server side. Derives every percentage, on every component, from the counts it carries. */
public class MutationPercentComputer implements MeasureComputer {

  private static List<String> inputs() {
    List<String> keys = new ArrayList<>();
    for (String k : MutationCountsComputer.metricKeys()) {
      keys.add(k);
    }
    return keys;
  }

  private static List<String> outputs() {
    List<String> keys = new ArrayList<>();
    for (MutationMetrics.Scope scope : MutationMetrics.Scope.values()) {
      for (MutationMetrics.Base base : MutationMetrics.Base.values()) {
        if (base.isPercent()) {
          keys.add(base.key(scope));
        }
      }
    }
    return keys;
  }

  @Override
  public MeasureComputerDefinition define(MeasureComputerDefinitionContext context) {
    return context.newDefinitionBuilder()
        .setInputMetrics(inputs().toArray(new String[0]))
        .setOutputMetrics(outputs().toArray(new String[0]))
        .build();
  }

  @Override
  public void compute(MeasureComputerContext context) {
    for (MutationMetrics.Scope scope : MutationMetrics.Scope.values()) {
      put(context, MutationMetrics.Base.SCORE.key(scope),
          ratio(value(context, MutationMetrics.Base.KILLED, scope), value(context, MutationMetrics.Base.TOTAL, scope)));
      Integer killed = value(context, MutationMetrics.Base.KILLED, scope);
      Integer survived = value(context, MutationMetrics.Base.SURVIVED, scope);
      put(context, MutationMetrics.Base.TEST_STRENGTH.key(scope),
          killed == null || survived == null ? null : ratio(killed, killed + survived));
      put(context, MutationMetrics.Base.DENSITY.key(scope),
          ratio(value(context, MutationMetrics.Base.TOTAL, scope), value(context, MutationMetrics.Base.LINES, scope)));
      put(context, MutationMetrics.Base.ALIVE_PERCENT.key(scope),
          ratio(value(context, MutationMetrics.Base.ALIVE, scope), value(context, MutationMetrics.Base.GLOBAL_ALIVE, scope)));
      put(context, MutationMetrics.Base.TOTAL_PERCENT.key(scope),
          ratio(value(context, MutationMetrics.Base.TOTAL, scope), value(context, MutationMetrics.Base.GLOBAL_TOTAL, scope)));
      put(context, MutationMetrics.Base.TEST_KILL_RATIO.key(scope),
          ratio(value(context, MutationMetrics.Base.TEST_KILLS, scope), value(context, MutationMetrics.Base.TESTS_EXECUTED, scope)));
    }
  }

  private static Integer value(MeasureComputerContext context, MutationMetrics.Base base, MutationMetrics.Scope scope) {
    Measure m = context.getMeasure(base.key(scope));
    return m == null ? null : m.getIntValue();
  }

  /** Percentage, or null when it cannot be computed (missing input or zero denominator). */
  static Double ratio(Integer numerator, Integer denominator) {
    if (numerator == null || denominator == null || denominator <= 0) {
      return null;
    }
    return 100.0 * numerator / denominator;
  }

  private static void put(MeasureComputerContext context, String key, Double value) {
    if (value != null && context.getMeasure(key) == null) {
      context.addMeasure(key, value);
    }
  }
}
