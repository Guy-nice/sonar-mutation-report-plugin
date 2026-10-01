package com.nice.sonar.mutation;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.StringReader;
import org.junit.jupiter.api.Test;

class ReportParserTest {

  private static Report parse(String json) {
    return ReportParser.parse(new StringReader(json));
  }

  @Test
  void readsTheFullReport() {
    Report r = TestReports.valid();
    assertThat(r.threshold).isEqualTo(80.0);
    assertThat(r.summary.overall.total).isEqualTo(30);
    assertThat(r.summary.overall.testsExecuted).isEqualTo(90);
    assertThat(r.summary.changed.total).isEqualTo(11);
    assertThat(r.files).containsOnlyKeys("src/a.ts", "src/missing.ts", "tool/b.py");
    assertThat(r.files.get("src/a.ts").changedLines).isEqualTo(8);
    assertThat(r.files.get("tool/b.py").counts.changed).isNull();
    assertThat(r.languages).containsKeys("typescript", "python");
    assertThat(r.mutants).hasSize(4);
  }

  @Test
  void totalIsDerivedWhenAbsent() {
    Report r = parse("{\"schemaVersion\":1,\"summary\":{\"overall\":{\"killed\":3,\"survived\":1}}}");
    assertThat(r.summary.overall.total).isEqualTo(4);
  }

  @Test
  void rejectsUnknownMajorVersion() {
    assertThatThrownBy(() -> parse("{\"schemaVersion\":2,\"summary\":{\"overall\":{}}}"))
        .isInstanceOf(IllegalArgumentException.class).hasMessageContaining("unsupported schemaVersion 2");
  }

  @Test
  void rejectsMissingRequiredFields() {
    assertThatThrownBy(() -> parse("{\"summary\":{\"overall\":{}}}"))
        .hasMessageContaining("schemaVersion");
    assertThatThrownBy(() -> parse("{\"schemaVersion\":1}")).hasMessageContaining("summary");
    assertThatThrownBy(() -> parse("{\"schemaVersion\":1,\"summary\":{}}")).hasMessageContaining("overall");
  }

  @Test
  void rejectsInconsistentCounts() {
    assertThatThrownBy(() -> parse("{\"schemaVersion\":1,\"summary\":{\"overall\":{\"total\":2,\"killed\":3}}}"))
        .hasMessageContaining("smaller than the sum");
    assertThatThrownBy(() -> parse("{\"schemaVersion\":1,\"summary\":{\"overall\":{\"killed\":-1}}}"))
        .hasMessageContaining("negative");
  }

  @Test
  void rejectsBadMutantStatus() {
    String json = "{\"schemaVersion\":1,\"summary\":{\"overall\":{}},\"mutants\":"
        + "[{\"file\":\"a\",\"line\":1,\"status\":\"KILLED\"}]}";
    assertThatThrownBy(() -> parse(json)).hasMessageContaining("SURVIVED or NO_COVERAGE");
  }

  @Test
  void rejectsGarbage() {
    assertThatThrownBy(() -> parse("not json")).isInstanceOf(IllegalArgumentException.class);
  }
}
