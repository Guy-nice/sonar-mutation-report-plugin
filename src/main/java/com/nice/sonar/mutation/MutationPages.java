package com.nice.sonar.mutation;

import org.sonar.api.web.page.Context;
import org.sonar.api.web.page.Page;
import org.sonar.api.web.page.PageDefinition;

/** Registers the three mutation dashboard pages. The JavaScript lives in static/ (built from frontend/). */
public class MutationPages implements PageDefinition {

  public static final String OVERVIEW_KEY = "mutationreport/overview";
  public static final String PROJECT_KEY = "mutationreport/project";
  public static final String PORTFOLIO_KEY = "mutationreport/portfolio";

  @Override
  public void define(Context context) {
    context.addPage(Page.builder(OVERVIEW_KEY)
        .setName("Mutation overview")
        .setScope(Page.Scope.GLOBAL)
        .build());
    context.addPage(Page.builder(PROJECT_KEY)
        .setName("Mutation")
        .setScope(Page.Scope.COMPONENT)
        .setComponentQualifiers(Page.Qualifier.PROJECT)
        .build());
    // On a Portfolio (and sub-portfolio): one row per project, coverage and mutation side by side.
    context.addPage(Page.builder(PORTFOLIO_KEY)
        .setName("Mutation breakdown")
        .setScope(Page.Scope.COMPONENT)
        .setComponentQualifiers(Page.Qualifier.VIEW, Page.Qualifier.SUB_VIEW)
        .build());
  }
}
