package com.nice.sonar.mutation;

import org.sonar.api.Plugin;

public class MutationReportPlugin implements Plugin {
  @Override
  public void define(Context context) {
    context.addExtensions(MutationMetrics.class, MutationReportSensor.class, MutationCountsComputer.class,
        MutationPercentComputer.class, MutationPages.class);
  }
}
