package com.nice.sonar.mutation;

import java.io.StringReader;

/** Shared sample report: one TypeScript file in the PR, one Python file, a mix of statuses. */
final class TestReports {

  static final String VALID = """
      {
        "schemaVersion": 1,
        "futureField": "ignored by this plugin",
        "run": { "runId": "r1", "threshold": 80 },
        "summary": {
          "overall": { "total": 30, "killed": 22, "timedOut": 1, "memoryError": 1, "survived": 5,
                       "noCoverage": 1, "suppressed": 2, "testsExecuted": 90, "testKills": 24 },
          "new":     { "total": 11, "killed": 9, "survived": 2 }
        },
        "languages": {
          "TypeScript": { "overall": { "total": 20, "killed": 15, "survived": 5 },
                          "new": { "total": 11, "killed": 9, "survived": 2 } },
          "python":     { "overall": { "total": 10, "killed": 7, "noCoverage": 1, "timedOut": 1, "memoryError": 1 } },
          "cobol":      { "overall": { "total": 0 } }
        },
        "files": {
          "src/a.ts": { "language": "typescript", "lines": 40, "changedLines": 8,
                        "overall": { "total": 20, "killed": 15, "survived": 5 },
                        "new": { "total": 11, "killed": 9, "survived": 2 } },
          "src/missing.ts": { "language": "typescript", "overall": { "total": 1, "killed": 1 } },
          "tool/b.py": { "language": "python", "lines": 20,
                         "overall": { "total": 10, "killed": 7, "noCoverage": 1, "timedOut": 1, "memoryError": 1 } }
        },
        "mutants": [
          { "file": "src/a.ts", "line": 10, "operator": "EqualityOperator", "status": "SURVIVED" },
          { "file": "src/a.ts", "line": 99, "operator": "OutOfRange", "status": "SURVIVED" },
          { "file": "tool/b.py", "line": 5, "operator": "BlockStatement", "status": "NO_COVERAGE" },
          { "file": "not/analyzed.ts", "line": 1, "operator": "X", "status": "SURVIVED" }
        ]
      }
      """;

  static Report valid() {
    return ReportParser.parse(new StringReader(VALID));
  }

  private TestReports() {
  }
}
