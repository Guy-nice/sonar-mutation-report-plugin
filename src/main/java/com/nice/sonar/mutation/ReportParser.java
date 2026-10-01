package com.nice.sonar.mutation;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.io.Reader;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Reads the mutation report written by the agent. Unknown fields are ignored so a newer agent keeps
 * working with an older plugin; an unknown MAJOR schema version is rejected.
 */
public final class ReportParser {

  public static final int SUPPORTED_MAJOR = 1;

  private ReportParser() {
  }

  public static Report parse(Reader reader) {
    JsonObject root;
    try {
      root = JsonParser.parseReader(reader).getAsJsonObject();
    } catch (RuntimeException e) {
      throw new IllegalArgumentException("not a valid JSON object: " + e.getMessage(), e);
    }
    int version = requireInt(root, "schemaVersion", "report");
    if (version != SUPPORTED_MAJOR) {
      throw new IllegalArgumentException("unsupported schemaVersion " + version
          + " (this plugin reads major version " + SUPPORTED_MAJOR + ")");
    }
    JsonObject summaryJson = requireObject(root, "summary", "report");
    Report.Scoped summary = scoped(summaryJson, "summary");

    Double threshold = null;
    if (root.has("run") && root.get("run").isJsonObject() && root.getAsJsonObject("run").has("threshold")) {
      threshold = root.getAsJsonObject("run").get("threshold").getAsDouble();
    }

    Map<String, Report.Scoped> languages = new LinkedHashMap<>();
    if (root.has("languages")) {
      for (Map.Entry<String, JsonElement> e : root.getAsJsonObject("languages").entrySet()) {
        languages.put(e.getKey().toLowerCase(java.util.Locale.ROOT), scoped(e.getValue().getAsJsonObject(), "languages." + e.getKey()));
      }
    }

    Map<String, Report.FileEntry> files = new LinkedHashMap<>();
    if (root.has("files")) {
      for (Map.Entry<String, JsonElement> e : root.getAsJsonObject("files").entrySet()) {
        JsonObject f = e.getValue().getAsJsonObject();
        String lang = f.has("language") ? f.get("language").getAsString() : "other";
        int lines = f.has("lines") ? f.get("lines").getAsInt() : -1;
        int changedLines = f.has("changedLines") ? f.get("changedLines").getAsInt() : -1;
        files.put(e.getKey(), new Report.FileEntry(lang, lines, changedLines, scoped(f, "files." + e.getKey())));
      }
    }

    List<Report.Mutant> mutants = new ArrayList<>();
    if (root.has("mutants")) {
      JsonArray arr = root.getAsJsonArray("mutants");
      for (int i = 0; i < arr.size(); i++) {
        JsonObject m = arr.get(i).getAsJsonObject();
        String where = "mutants[" + i + "]";
        String status = requireString(m, "status", where);
        if (!status.equals("SURVIVED") && !status.equals("NO_COVERAGE")) {
          throw new IllegalArgumentException(where + ".status must be SURVIVED or NO_COVERAGE, was " + status);
        }
        mutants.add(new Report.Mutant(requireString(m, "file", where), requireInt(m, "line", where),
            m.has("operator") ? m.get("operator").getAsString() : "unknown", status));
      }
    }
    return new Report(version, threshold, summary, languages, files, mutants);
  }

  private static Report.Scoped scoped(JsonObject parent, String where) {
    JsonObject overall = requireObject(parent, "overall", where);
    Counts changed = parent.has("new") ? counts(parent.getAsJsonObject("new"), where + ".new") : null;
    return new Report.Scoped(counts(overall, where + ".overall"), changed);
  }

  private static Counts counts(JsonObject o, String where) {
    int killed = optInt(o, "killed");
    int timedOut = optInt(o, "timedOut");
    int memoryError = optInt(o, "memoryError");
    int survived = optInt(o, "survived");
    int noCoverage = optInt(o, "noCoverage");
    int unknown = optInt(o, "unknown");
    int total = o.has("total") ? o.get("total").getAsInt()
        : killed + timedOut + memoryError + survived + noCoverage + unknown;
    int parts = killed + timedOut + memoryError + survived + noCoverage + unknown;
    if (total < parts) {
      throw new IllegalArgumentException(where + ": total (" + total + ") is smaller than the sum of its parts (" + parts + ")");
    }
    return new Counts(total, killed, timedOut, memoryError, survived, noCoverage, unknown, optInt(o, "suppressed"),
        o.has("testsExecuted") ? o.get("testsExecuted").getAsInt() : null,
        o.has("testKills") ? o.get("testKills").getAsInt() : null);
  }

  private static int optInt(JsonObject o, String key) {
    int v = o.has(key) ? o.get(key).getAsInt() : 0;
    if (v < 0) {
      throw new IllegalArgumentException(key + " must not be negative, was " + v);
    }
    return v;
  }

  private static int requireInt(JsonObject o, String key, String where) {
    if (!o.has(key)) {
      throw new IllegalArgumentException(where + " is missing required field '" + key + "'");
    }
    return o.get(key).getAsInt();
  }

  private static String requireString(JsonObject o, String key, String where) {
    if (!o.has(key)) {
      throw new IllegalArgumentException(where + " is missing required field '" + key + "'");
    }
    return o.get(key).getAsString();
  }

  private static JsonObject requireObject(JsonObject o, String key, String where) {
    if (!o.has(key) || !o.get(key).isJsonObject()) {
      throw new IllegalArgumentException(where + " is missing required object '" + key + "'");
    }
    return o.getAsJsonObject(key);
  }
}
