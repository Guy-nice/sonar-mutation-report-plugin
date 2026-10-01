package com.nice.sonar.mutation;

import java.util.OptionalDouble;

/** Mutant counts for one scope (a file, a language, or the whole report). Immutable. */
public final class Counts {

  public static final Counts EMPTY = new Counts(0, 0, 0, 0, 0, 0, 0, 0, null, null);

  public final int total;
  public final int killed;
  public final int timedOut;
  public final int memoryError;
  public final int survived;
  public final int noCoverage;
  public final int unknown;
  public final int suppressed;
  /** Null when the engine did not report per-test data. */
  public final Integer testsExecuted;
  public final Integer testKills;

  public Counts(int total, int killed, int timedOut, int memoryError, int survived, int noCoverage,
      int unknown, int suppressed, Integer testsExecuted, Integer testKills) {
    this.total = total;
    this.killed = killed;
    this.timedOut = timedOut;
    this.memoryError = memoryError;
    this.survived = survived;
    this.noCoverage = noCoverage;
    this.unknown = unknown;
    this.suppressed = suppressed;
    this.testsExecuted = testsExecuted;
    this.testKills = testKills;
  }

  /** Killed by a test, a timeout or a memory error (DevCon5 "detected"). */
  public int killedTotal() {
    return killed + timedOut + memoryError;
  }

  /** Still alive: covered survivors plus mutants no test reaches. */
  public int alive() {
    return survived + noCoverage;
  }

  /** The agent's gate formula: killed by tests / total. Timeouts and memory errors do not count as kills. */
  public OptionalDouble score() {
    return total > 0 ? OptionalDouble.of(100.0 * killed / total) : OptionalDouble.empty();
  }

  public OptionalDouble testStrength() {
    int covered = killed + survived;
    return covered > 0 ? OptionalDouble.of(100.0 * killed / covered) : OptionalDouble.empty();
  }
}
