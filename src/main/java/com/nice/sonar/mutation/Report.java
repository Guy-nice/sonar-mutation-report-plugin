package com.nice.sonar.mutation;

import java.util.List;
import java.util.Map;

/** Parsed mutation report (schema v1). */
public final class Report {

  /** Counts for the whole scope, and for the part of it on lines changed by the pull request. */
  public static final class Scoped {
    public final Counts overall;
    public final Counts changed;

    public Scoped(Counts overall, Counts changed) {
      this.overall = overall;
      this.changed = changed;
    }
  }

  public static final class FileEntry {
    public final String language;
    /** Analyzable lines in the file overall, or -1 when unknown. */
    public final int lines;
    /** Analyzable lines the pull request changed in this file, or -1 when unknown. */
    public final int changedLines;
    public final Scoped counts;

    public FileEntry(String language, int lines, int changedLines, Scoped counts) {
      this.language = language;
      this.lines = lines;
      this.changedLines = changedLines;
      this.counts = counts;
    }
  }

  public static final class Mutant {
    public final String file;
    public final int line;
    public final String operator;
    /** SURVIVED or NO_COVERAGE. */
    public final String status;

    public Mutant(String file, int line, String operator, String status) {
      this.file = file;
      this.line = line;
      this.operator = operator;
      this.status = status;
    }
  }

  public final int schemaVersion;
  public final Double threshold;
  public final Scoped summary;
  public final Map<String, Scoped> languages;
  public final Map<String, FileEntry> files;
  public final List<Mutant> mutants;

  public Report(int schemaVersion, Double threshold, Scoped summary, Map<String, Scoped> languages,
      Map<String, FileEntry> files, List<Mutant> mutants) {
    this.schemaVersion = schemaVersion;
    this.threshold = threshold;
    this.summary = summary;
    this.languages = languages;
    this.files = files;
    this.mutants = mutants;
  }
}
