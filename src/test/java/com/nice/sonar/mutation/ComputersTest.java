package com.nice.sonar.mutation;

import static org.assertj.core.api.Assertions.assertThat;

import java.lang.reflect.Proxy;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.sonar.api.ce.measure.Measure;
import org.sonar.api.ce.measure.MeasureComputer;
import org.sonar.api.ce.measure.MeasureComputer.MeasureComputerContext;

class ComputersTest {

  /** A component as the computer sees it: its own measures, its children's, and what the computer adds. */
  static final class Fake {
    final Map<String, Number> own = new HashMap<>();
    final Map<String, List<Number>> children = new HashMap<>();
    final Map<String, Number> added = new HashMap<>();

    Fake own(String k, Number v) {
      own.put(k, v);
      return this;
    }

    Fake child(String k, Number v) {
      children.computeIfAbsent(k, x -> new ArrayList<>()).add(v);
      return this;
    }

    private static Measure measure(Number n) {
      return (Measure) Proxy.newProxyInstance(Measure.class.getClassLoader(), new Class<?>[] {Measure.class},
          (p, m, a) -> m.getName().equals("getIntValue") ? (Object) n.intValue() : (Object) n.doubleValue());
    }

    MeasureComputerContext context() {
      return (MeasureComputerContext) Proxy.newProxyInstance(MeasureComputerContext.class.getClassLoader(),
          new Class<?>[] {MeasureComputerContext.class}, (p, m, a) -> {
            switch (m.getName()) {
              case "getMeasure": {
                String key = (String) a[0];
                Number n = own.containsKey(key) ? own.get(key) : added.get(key);
                return n == null ? null : measure(n);
              }
              case "getChildrenMeasures": {
                List<Measure> out = new ArrayList<>();
                children.getOrDefault((String) a[0], List.of()).forEach(n -> out.add(measure(n)));
                return out;
              }
              case "addMeasure":
                added.put((String) a[0], (Number) a[1]);
                return null;
              default:
                throw new UnsupportedOperationException(m.getName());
            }
          });
    }
  }

  @Test
  void countsComputerSumsFolderChildrenAndLeavesExistingMeasuresAlone() {
    Fake folder = new Fake().child("mutation_total", 20).child("mutation_total", 10)
        .child("new_mutation_survived", 2).child("new_mutation_survived", 1);
    new MutationCountsComputer().compute(folder.context());
    assertThat(folder.added).containsEntry("mutation_total", 30).containsEntry("new_mutation_survived", 3);
    assertThat(folder.added).doesNotContainKey("mutation_killed");

    Fake project = new Fake().own("mutation_total", 99).child("mutation_total", 1);
    new MutationCountsComputer().compute(project.context());
    assertThat(project.added).doesNotContainKey("mutation_total");
  }

  @Test
  void countsComputerTakesProjectWideConstantsAsMaxNotSum() {
    Fake folder = new Fake().child("mutation_global_total", 30).child("mutation_global_total", 30)
        .child("mutation_global_alive", 6).child("mutation_global_alive", 6);
    new MutationCountsComputer().compute(folder.context());
    assertThat(folder.added).containsEntry("mutation_global_total", 30).containsEntry("mutation_global_alive", 6);
  }

  @Test
  void percentComputerDerivesEveryPercentageFromCounts() {
    Fake file = new Fake()
        .own("mutation_total", 20).own("mutation_killed", 15).own("mutation_survived", 5)
        .own("mutation_alive", 5).own("mutation_lines", 40)
        .own("mutation_global_total", 30).own("mutation_global_alive", 6)
        .own("mutation_tests_executed", 90).own("mutation_test_kills", 45);
    new MutationPercentComputer().compute(file.context());

    assertThat(file.added.get("mutation_score").doubleValue()).isEqualTo(75.0);
    assertThat(file.added.get("mutation_test_strength").doubleValue()).isEqualTo(75.0);
    assertThat(file.added.get("mutation_density").doubleValue()).isEqualTo(50.0);
    assertThat(file.added.get("mutation_alive_percent").doubleValue()).isEqualTo(100.0 * 5 / 6);
    assertThat(file.added.get("mutation_total_percent").doubleValue()).isEqualTo(100.0 * 20 / 30);
    assertThat(file.added.get("mutation_test_kill_ratio").doubleValue()).isEqualTo(50.0);
  }

  @Test
  void percentComputerWorksOnTheNewCodeScopeIndependently() {
    Fake project = new Fake().own("new_mutation_total", 11).own("new_mutation_killed", 9);
    new MutationPercentComputer().compute(project.context());
    assertThat(project.added.get("new_mutation_score").doubleValue()).isEqualTo(100.0 * 9 / 11);
    assertThat(project.added).doesNotContainKey("mutation_score");
  }

  @Test
  void percentComputerOmitsWhatItCannotCompute() {
    Fake empty = new Fake().own("mutation_total", 0).own("mutation_killed", 0).own("mutation_survived", 0);
    new MutationPercentComputer().compute(empty.context());
    assertThat(empty.added).isEmpty();
  }

  @Test
  void percentComputerDoesNotOverwriteAnExistingPercentage() {
    Fake c = new Fake().own("mutation_total", 10).own("mutation_killed", 5).own("mutation_score", 12.5);
    new MutationPercentComputer().compute(c.context());
    assertThat(c.added).doesNotContainKey("mutation_score");
  }

  @Test
  void computersDeclareDisjointOutputsSoTheServerCanOrderThem() {
    MeasureComputer.MeasureComputerDefinition counts = definition(new MutationCountsComputer());
    MeasureComputer.MeasureComputerDefinition percents = definition(new MutationPercentComputer());
    assertThat(percents.getInputMetrics()).containsAll(counts.getOutputMetrics());
    assertThat(percents.getOutputMetrics()).doesNotContainAnyElementsOf(counts.getOutputMetrics());
  }

  /** Runs define() against a recording fake of the server's definition builder. */
  private static MeasureComputer.MeasureComputerDefinition definition(MeasureComputer computer) {
    Map<String, Set<String>> recorded = new HashMap<>();
    Class<?> builderType = MeasureComputer.MeasureComputerDefinition.Builder.class;
    Object builder = Proxy.newProxyInstance(builderType.getClassLoader(), new Class<?>[] {builderType},
        new java.lang.reflect.InvocationHandler() {
          @Override
          public Object invoke(Object self, java.lang.reflect.Method m, Object[] a) {
            if (m.getName().equals("build")) {
              return Proxy.newProxyInstance(MeasureComputer.MeasureComputerDefinition.class.getClassLoader(),
                  new Class<?>[] {MeasureComputer.MeasureComputerDefinition.class}, (p, dm, da) ->
                      dm.getName().equals("getInputMetrics") ? recorded.getOrDefault("in", Set.of())
                          : recorded.getOrDefault("out", Set.of()));
            }
            recorded.put(m.getName().equals("setInputMetrics") ? "in" : "out",
                new java.util.LinkedHashSet<>(java.util.Arrays.asList((String[]) a[0])));
            return self;
          }
        });
    Object defContext = Proxy.newProxyInstance(
        MeasureComputer.MeasureComputerDefinitionContext.class.getClassLoader(),
        new Class<?>[] {MeasureComputer.MeasureComputerDefinitionContext.class}, (p, m, a) -> builder);
    return computer.define((MeasureComputer.MeasureComputerDefinitionContext) defContext);
  }
}
