package com.nice.sonar.mutation;

import java.util.ArrayList;
import java.util.List;
import org.sonar.api.ce.measure.Measure;
import org.sonar.api.ce.measure.MeasureComputer;

/**
 * Server side. Folders have no measures of their own, so sum their children's additive counts (and take
 * the project-wide constants from any child). Components that already carry a measure (files and the
 * project, saved by the sensor) are left untouched.
 */
public class MutationCountsComputer implements MeasureComputer {

  static List<String> metricKeys() {
    List<String> keys = new ArrayList<>();
    for (MutationMetrics.Scope scope : MutationMetrics.Scope.values()) {
      for (MutationMetrics.Base base : MutationMetrics.Base.values()) {
        if (!base.isPercent()) {
          keys.add(base.key(scope));
        }
      }
    }
    return keys;
  }

  static boolean isConstant(String key) {
    return key.endsWith("mutation_global_total") || key.endsWith("mutation_global_alive");
  }

  @Override
  public MeasureComputerDefinition define(MeasureComputerDefinitionContext context) {
    return context.newDefinitionBuilder().setOutputMetrics(metricKeys().toArray(new String[0])).build();
  }

  @Override
  public void compute(MeasureComputerContext context) {
    for (String key : metricKeys()) {
      if (context.getMeasure(key) != null) {
        continue;
      }
      boolean any = false;
      int sum = 0;
      int max = 0;
      for (Measure child : context.getChildrenMeasures(key)) {
        any = true;
        sum += child.getIntValue();
        max = Math.max(max, child.getIntValue());
      }
      if (any) {
        context.addMeasure(key, isConstant(key) ? max : sum);
      }
    }
  }
}
