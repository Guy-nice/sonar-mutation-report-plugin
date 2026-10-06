package com.nice.sonar.mutation;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import org.junit.jupiter.api.Test;
import org.sonar.api.web.page.Context;
import org.sonar.api.web.page.Page;

class MutationPagesTest {

  private static List<Page> pages() {
    Context context = new Context();
    new MutationPages().define(context);
    return List.copyOf(context.getPages());
  }

  @Test
  void registersTheOverviewAsAGlobalPage() {
    Page overview = pages().stream().filter(p -> p.getKey().equals("mutationreport/overview")).findFirst().orElseThrow();
    assertThat(overview.getScope()).isEqualTo(Page.Scope.GLOBAL);
    assertThat(overview.getName()).isEqualTo("Mutation overview");
    assertThat(overview.isAdmin()).isFalse();
  }

  @Test
  void registersTheProjectPageForProjectsOnly() {
    Page project = pages().stream().filter(p -> p.getKey().equals("mutationreport/project")).findFirst().orElseThrow();
    assertThat(project.getScope()).isEqualTo(Page.Scope.COMPONENT);
    assertThat(project.getName()).isEqualTo("Mutation");
    assertThat(project.getComponentQualifiers()).containsExactly(Page.Qualifier.PROJECT);
  }

  @Test
  void registersExactlyTwoPages() {
    assertThat(pages()).hasSize(2);
  }

  @Test
  void bundlesForBothPagesArePackagedAsStaticResources() {
    assertThat(getClass().getResource("/static/overview.js")).isNotNull();
    assertThat(getClass().getResource("/static/project.js")).isNotNull();
  }
}
