package com.nice.sonar.mutation;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.io.IOException;
import java.io.Reader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import org.sonar.api.batch.sensor.Sensor;
import org.sonar.api.batch.sensor.SensorContext;
import org.sonar.api.batch.sensor.SensorDescriptor;
import org.sonar.api.utils.log.Logger;
import org.sonar.api.utils.log.Loggers;

/** Passive: reads the report the agent produced and publishes its numbers. Runs no mutation testing. */
public class MutationReportSensor implements Sensor {

  private static final Logger LOG = Loggers.get(MutationReportSensor.class);
  static final String REPORT_PATH = "sonar.mutation.reportPath";

  @Override
  public void describe(SensorDescriptor descriptor) {
    descriptor.name("Mutation Report").onlyWhenConfiguration(c -> c.hasKey(REPORT_PATH));
  }

  @Override
  public void execute(SensorContext context) {
    String configured = context.config().get(REPORT_PATH).orElseThrow();
    Path report = context.fileSystem().baseDir().toPath().resolve(configured);
    if (!Files.isRegularFile(report)) {
      LOG.warn("Mutation report not found: {}", report);
      return;
    }
    try (Reader reader = Files.newBufferedReader(report, StandardCharsets.UTF_8)) {
      JsonObject summary = JsonParser.parseReader(reader).getAsJsonObject().getAsJsonObject("summary");
      double score = summary.get("mutation_score").getAsDouble();
      context.<Double>newMeasure().forMetric(MutationMetrics.MUTATION_SCORE).on(context.project()).withValue(score).save();
      if (summary.has("new_mutation_score")) {
        double newScore = summary.get("new_mutation_score").getAsDouble();
        context.<Double>newMeasure().forMetric(MutationMetrics.NEW_MUTATION_SCORE).on(context.project()).withValue(newScore).save();
      }
      LOG.info("Mutation Report: published mutation_score={} from {}", score, report);
    } catch (IOException | RuntimeException e) {
      throw new IllegalStateException("Cannot read mutation report " + report + ": " + e.getMessage(), e);
    }
  }
}
