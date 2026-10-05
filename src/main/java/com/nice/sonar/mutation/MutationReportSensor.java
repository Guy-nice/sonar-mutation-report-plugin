package com.nice.sonar.mutation;

import java.io.IOException;
import java.io.Reader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.Map;
import org.sonar.api.batch.fs.FilePredicates;
import org.sonar.api.batch.fs.InputComponent;
import org.sonar.api.batch.fs.InputFile;
import org.sonar.api.batch.rule.Severity;
import org.sonar.api.batch.sensor.Sensor;
import org.sonar.api.batch.sensor.SensorContext;
import org.sonar.api.batch.sensor.SensorDescriptor;
import org.sonar.api.batch.sensor.issue.NewExternalIssue;
import org.sonar.api.batch.sensor.issue.NewIssueLocation;
import org.sonar.api.issue.impact.SoftwareQuality;
import org.sonar.api.rules.CleanCodeAttribute;
import org.sonar.api.rules.RuleType;
import org.sonar.api.measures.Metric;
import org.sonar.api.utils.log.Logger;
import org.sonar.api.utils.log.Loggers;

/**
 * Passive: reads the report the agent produced and publishes it. Runs no mutation testing.
 *
 * Publishes additive counts per file and for the project (folders are summed up by the computers, and
 * every percentage is derived server-side from counts), per-language project measures, and one external
 * issue per surviving or uncovered mutant.
 */
public class MutationReportSensor implements Sensor {

  private static final Logger LOG = Loggers.get(MutationReportSensor.class);
  public static final String REPORT_PATH = "sonar.mutation.reportPath";
  public static final String ENGINE_ID = "mutation-report";

  @Override
  public void describe(SensorDescriptor descriptor) {
    descriptor.name("Mutation Report").onlyWhenConfiguration(c -> c.hasKey(REPORT_PATH));
  }

  @Override
  public void execute(SensorContext context) {
    String configured = context.config().get(REPORT_PATH).orElseThrow();
    Path path = context.fileSystem().baseDir().toPath().resolve(configured);
    if (!Files.isRegularFile(path)) {
      LOG.warn("Mutation report not found: {}", path);
      return;
    }
    Report report;
    try (Reader reader = Files.newBufferedReader(path, StandardCharsets.UTF_8)) {
      report = ReportParser.parse(reader);
    } catch (IOException | IllegalArgumentException e) {
      throw new IllegalStateException("Invalid mutation report " + path + ": " + e.getMessage(), e);
    }

    publishProject(context, report);
    publishLanguages(context, report);
    int files = publishFiles(context, report);
    int issues = publishIssues(context, report);
    LOG.info("Mutation Report: published mutation_score={} ({} files, {} issues) from {}",
        report.summary.overall.score().isPresent() ? round1(report.summary.overall.score().getAsDouble()) : "n/a",
        files, issues, path);
  }

  private static void publishProject(SensorContext context, Report report) {
    InputComponent project = context.project();
    saveCounts(context, project, report.summary.overall, MutationMetrics.Scope.OVERALL);
    if (report.summary.changed != null) {
      saveCounts(context, project, report.summary.changed, MutationMetrics.Scope.NEW);
    }
    if (report.threshold != null) {
      save(context, project, MutationMetrics.thresholdKey(), Metric.ValueType.PERCENT, report.threshold);
    }
  }

  private static void publishLanguages(SensorContext context, Report report) {
    Map<String, Report.Scoped> buckets = new HashMap<>();
    for (Map.Entry<String, Report.Scoped> e : report.languages.entrySet()) {
      buckets.merge(MutationMetrics.bucket(e.getKey()), e.getValue(), MutationReportSensor::merge);
    }
    for (Map.Entry<String, Report.Scoped> e : buckets.entrySet()) {
      saveLanguage(context, e.getKey(), e.getValue().overall, MutationMetrics.Scope.OVERALL);
      if (e.getValue().changed != null) {
        saveLanguage(context, e.getKey(), e.getValue().changed, MutationMetrics.Scope.NEW);
      }
    }
  }

  private static void saveLanguage(SensorContext context, String lang, Counts c, MutationMetrics.Scope scope) {
    InputComponent project = context.project();
    c.score().ifPresent(v -> save(context, project, MutationMetrics.languageKey(lang, "score", scope),
        Metric.ValueType.PERCENT, v));
    save(context, project, MutationMetrics.languageKey(lang, "total", scope), Metric.ValueType.INT, c.total);
    save(context, project, MutationMetrics.languageKey(lang, "killed", scope), Metric.ValueType.INT, c.killed);
    save(context, project, MutationMetrics.languageKey(lang, "survived", scope), Metric.ValueType.INT, c.survived);
  }

  static Report.Scoped merge(Report.Scoped a, Report.Scoped b) {
    return new Report.Scoped(add(a.overall, b.overall),
        a.changed == null || b.changed == null ? (a.changed != null ? a.changed : b.changed) : add(a.changed, b.changed));
  }

  static Counts add(Counts a, Counts b) {
    return new Counts(a.total + b.total, a.killed + b.killed, a.timedOut + b.timedOut,
        a.memoryError + b.memoryError, a.survived + b.survived, a.noCoverage + b.noCoverage,
        a.unknown + b.unknown, a.suppressed + b.suppressed,
        sum(a.testsExecuted, b.testsExecuted), sum(a.testKills, b.testKills));
  }

  private static Integer sum(Integer a, Integer b) {
    return a == null ? b : (b == null ? a : Integer.valueOf(a + b));
  }

  private static int publishFiles(SensorContext context, Report report) {
    FilePredicates predicates = context.fileSystem().predicates();
    int published = 0;
    for (Map.Entry<String, Report.FileEntry> e : report.files.entrySet()) {
      InputFile file = context.fileSystem().inputFile(predicates.hasPath(e.getKey()));
      if (file == null) {
        LOG.debug("Mutation Report: {} is not part of the analysis, skipped", e.getKey());
        continue;
      }
      Report.FileEntry entry = e.getValue();
      saveCounts(context, file, entry.counts.overall, MutationMetrics.Scope.OVERALL);
      saveHelpers(context, file, report.summary.overall, entry.lines, MutationMetrics.Scope.OVERALL);
      if (entry.counts.changed != null && report.summary.changed != null) {
        saveCounts(context, file, entry.counts.changed, MutationMetrics.Scope.NEW);
        saveHelpers(context, file, report.summary.changed, entry.changedLines, MutationMetrics.Scope.NEW);
      }
      published++;
    }
    return published;
  }

  /** Lines for density, plus project-wide totals so every component can derive its hotspot share. */
  private static void saveHelpers(SensorContext context, InputComponent file, Counts project, int lines,
      MutationMetrics.Scope scope) {
    if (lines >= 0) {
      save(context, file, MutationMetrics.Base.LINES.key(scope), Metric.ValueType.INT, lines);
    }
    save(context, file, MutationMetrics.Base.GLOBAL_TOTAL.key(scope), Metric.ValueType.INT, project.total);
    save(context, file, MutationMetrics.Base.GLOBAL_ALIVE.key(scope), Metric.ValueType.INT, project.alive());
  }

  private static void saveCounts(SensorContext context, InputComponent component, Counts c,
      MutationMetrics.Scope scope) {
    MutationMetrics.Base[] additive = {
        MutationMetrics.Base.TOTAL, MutationMetrics.Base.KILLED, MutationMetrics.Base.TIMED_OUT,
        MutationMetrics.Base.MEMORY_ERROR, MutationMetrics.Base.KILLED_TOTAL, MutationMetrics.Base.SURVIVED,
        MutationMetrics.Base.NO_COVERAGE, MutationMetrics.Base.ALIVE, MutationMetrics.Base.UNKNOWN,
        MutationMetrics.Base.SUPPRESSED};
    int[] values = {c.total, c.killed, c.timedOut, c.memoryError, c.killedTotal(), c.survived, c.noCoverage,
        c.alive(), c.unknown, c.suppressed};
    for (int i = 0; i < additive.length; i++) {
      save(context, component, additive[i].key(scope), Metric.ValueType.INT, values[i]);
    }
    if (c.testsExecuted != null) {
      save(context, component, MutationMetrics.Base.TESTS_EXECUTED.key(scope), Metric.ValueType.INT, c.testsExecuted);
    }
    if (c.testKills != null) {
      save(context, component, MutationMetrics.Base.TEST_KILLS.key(scope), Metric.ValueType.INT, c.testKills);
    }
  }

  @SuppressWarnings({"unchecked", "rawtypes"})
  private static void save(SensorContext context, InputComponent component, String key, Metric.ValueType type,
      Number value) {
    Metric metric = new Metric.Builder(key, key, type).create();
    if (type == Metric.ValueType.INT) {
      context.<Integer>newMeasure().forMetric(metric).on(component).withValue(value.intValue()).save();
    } else {
      context.<Double>newMeasure().forMetric(metric).on(component).withValue(value.doubleValue()).save();
    }
  }

  private static int publishIssues(SensorContext context, Report report) {
    FilePredicates predicates = context.fileSystem().predicates();
    int created = 0;
    if (!report.mutants.isEmpty()) {
      registerRule(context, "survived", "Mutant survived the tests",
          "A mutation testing run changed this line and no test failed. The tests execute the line but do not "
              + "check its behavior. Add or strengthen an assertion.");
      registerRule(context, "no-coverage", "Mutant not covered by any test",
          "A mutation testing run could not execute this line from any test. Add a test that reaches it.");
    }
    for (Report.Mutant m : report.mutants) {
      InputFile file = context.fileSystem().inputFile(predicates.hasPath(m.file));
      if (file == null || m.line < 1 || m.line > file.lines()) {
        continue;
      }
      boolean uncovered = m.status.equals("NO_COVERAGE");
      NewExternalIssue issue = context.newExternalIssue()
          .engineId(ENGINE_ID)
          .ruleId(uncovered ? "no-coverage" : "survived")
          .type(RuleType.CODE_SMELL)
          .severity(Severity.MAJOR)
          .cleanCodeAttribute(CleanCodeAttribute.TESTED)
          .addImpact(SoftwareQuality.MAINTAINABILITY, org.sonar.api.issue.impact.Severity.MEDIUM);
      NewIssueLocation location = issue.newLocation().on(file).at(file.selectLine(m.line)).message(uncovered
          ? "No test reaches this line (" + m.operator + " mutant not executed). Add a test that exercises it."
          : "A test executes this line but does not detect the " + m.operator + " mutation. Strengthen the assertions.");
      issue.at(location).save();
      created++;
    }
    return created;
  }

  private static void registerRule(SensorContext context, String ruleId, String name, String description) {
    context.newAdHocRule()
        .engineId(ENGINE_ID)
        .ruleId(ruleId)
        .name(name)
        .description(description)
        .type(RuleType.CODE_SMELL)
        .severity(Severity.MAJOR)
        .cleanCodeAttribute(CleanCodeAttribute.TESTED)
        .addDefaultImpact(SoftwareQuality.MAINTAINABILITY, org.sonar.api.issue.impact.Severity.MEDIUM)
        .save();
  }

  private static String round1(double v) {
    return String.valueOf(Math.round(v * 10.0) / 10.0);
  }
}
