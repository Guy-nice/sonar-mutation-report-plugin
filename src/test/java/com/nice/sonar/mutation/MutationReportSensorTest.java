package com.nice.sonar.mutation;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.sonar.api.batch.fs.internal.TestInputFileBuilder;
import org.sonar.api.batch.sensor.internal.DefaultSensorDescriptor;
import org.sonar.api.batch.sensor.internal.SensorContextTester;

class MutationReportSensorTest {

  @TempDir
  Path dir;
  SensorContextTester context;

  @BeforeEach
  void setUp() throws IOException {
    context = SensorContextTester.create(dir);
    context.fileSystem().add(new TestInputFileBuilder("p", "src/a.ts").setModuleBaseDir(dir)
        .setLines(50).setOriginalLineEndOffsets(new int[50]).setOriginalLineStartOffsets(new int[50])
        .setContents("x\n".repeat(50)).build());
    context.fileSystem().add(new TestInputFileBuilder("p", "tool/b.py").setModuleBaseDir(dir)
        .setLines(30).setOriginalLineEndOffsets(new int[30]).setOriginalLineStartOffsets(new int[30])
        .setContents("x\n".repeat(30)).build());
  }

  private void report(String json) throws IOException {
    Files.createDirectories(dir.resolve(".sonar"));
    Files.writeString(dir.resolve(".sonar/mutation-report.json"), json, StandardCharsets.UTF_8);
    context.settings().setProperty(MutationReportSensor.REPORT_PATH, ".sonar/mutation-report.json");
  }

  private Integer fileInt(String file, String metric) {
    var m = context.measure("p:" + file, metric);
    return m == null ? null : (Integer) m.value();
  }

  private Integer projectInt(String metric) {
    var m = context.measure(context.project().key(), metric);
    return m == null ? null : (Integer) m.value();
  }

  private Double projectDouble(String metric) {
    var m = context.measure(context.project().key(), metric);
    return m == null ? null : (Double) m.value();
  }

  @Test
  void isOnlyActiveWhenTheReportPathIsConfigured() {
    DefaultSensorDescriptor descriptor = new DefaultSensorDescriptor();
    new MutationReportSensor().describe(descriptor);
    assertThat(descriptor.configurationPredicate()).isNotNull();
    assertThat(descriptor.configurationPredicate().test(context.config())).isFalse();
    context.settings().setProperty(MutationReportSensor.REPORT_PATH, "x.json");
    assertThat(descriptor.configurationPredicate().test(context.config())).isTrue();
  }

  @Test
  void publishesProjectCountsForBothScopes() throws IOException {
    report(TestReports.VALID);
    new MutationReportSensor().execute(context);

    assertThat(projectInt("mutation_total")).isEqualTo(30);
    assertThat(projectInt("mutation_killed")).isEqualTo(22);
    assertThat(projectInt("mutation_killed_total")).isEqualTo(24);
    assertThat(projectInt("mutation_alive")).isEqualTo(6);
    assertThat(projectInt("mutation_suppressed")).isEqualTo(2);
    assertThat(projectInt("mutation_tests_executed")).isEqualTo(90);
    assertThat(projectInt("new_mutation_total")).isEqualTo(11);
    assertThat(projectInt("new_mutation_killed")).isEqualTo(9);
    assertThat(projectDouble("mutation_threshold")).isEqualTo(80.0);
  }

  @Test
  void leavesPercentagesToTheServerSideComputers() throws IOException {
    report(TestReports.VALID);
    new MutationReportSensor().execute(context);
    assertThat(context.measure(context.project().key(), "mutation_score")).isNull();
    assertThat(context.measure(context.project().key(), "new_mutation_score")).isNull();
  }

  @Test
  void publishesPerFileCountsAndHelpersForFilesInTheAnalysis() throws IOException {
    report(TestReports.VALID);
    new MutationReportSensor().execute(context);

    assertThat(fileInt("src/a.ts", "mutation_total")).isEqualTo(20);
    assertThat(fileInt("src/a.ts", "mutation_survived")).isEqualTo(5);
    assertThat(fileInt("src/a.ts", "new_mutation_survived")).isEqualTo(2);
    assertThat(fileInt("src/a.ts", "mutation_lines")).isEqualTo(40);
    assertThat(fileInt("src/a.ts", "new_mutation_lines")).isEqualTo(8);
    assertThat(fileInt("src/a.ts", "mutation_global_total")).isEqualTo(30);
    assertThat(fileInt("src/a.ts", "mutation_global_alive")).isEqualTo(6);
    assertThat(fileInt("tool/b.py", "mutation_no_coverage")).isEqualTo(1);
    // python has no new-code data
    assertThat(fileInt("tool/b.py", "new_mutation_total")).isNull();
    // a file Sonar does not analyze is skipped, not an error
    assertThat(context.measure("p:src/missing.ts", "mutation_total")).isNull();
  }

  @Test
  void bucketsLanguagesAndPublishesTheFixedPerLanguageSet() throws IOException {
    report(TestReports.VALID);
    new MutationReportSensor().execute(context);

    assertThat(projectDouble("mutation_typescript_score")).isEqualTo(75.0);
    assertThat(projectInt("mutation_typescript_total")).isEqualTo(20);
    assertThat(projectInt("mutation_python_killed")).isEqualTo(7);
    assertThat(projectDouble("new_mutation_typescript_score")).isEqualTo(100.0 * 9 / 11);
    // cobol is not in the fixed list: lands in "other" (and has no score, total is 0)
    assertThat(projectInt("mutation_other_total")).isEqualTo(0);
    assertThat(projectDouble("mutation_other_score")).isNull();
  }

  @Test
  void raisesExternalIssuesOnlyForMutantsInTheAnalysisWithValidLines() throws IOException {
    report(TestReports.VALID);
    new MutationReportSensor().execute(context);

    assertThat(context.allExternalIssues()).hasSize(2);
    assertThat(context.allExternalIssues()).extracting(i -> i.ruleId())
        .containsExactlyInAnyOrder("survived", "no-coverage");
    assertThat(context.allExternalIssues()).allSatisfy(i -> assertThat(i.engineId()).isEqualTo("mutation-report"));
    assertThat(context.allAdHocRules()).extracting(r -> r.ruleId())
        .containsExactlyInAnyOrder("survived", "no-coverage");
  }

  @Test
  void aMissingReportIsAWarningNotAFailure() {
    context.settings().setProperty(MutationReportSensor.REPORT_PATH, ".sonar/nope.json");
    new MutationReportSensor().execute(context);
    assertThat(context.allExternalIssues()).isEmpty();
  }

  @Test
  void anInvalidReportFailsTheScanWithAClearMessage() throws IOException {
    report("{\"schemaVersion\": 7, \"summary\": {\"overall\": {}}}");
    assertThatThrownBy(() -> new MutationReportSensor().execute(context))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("Invalid mutation report")
        .hasMessageContaining("unsupported schemaVersion 7");
  }
}
