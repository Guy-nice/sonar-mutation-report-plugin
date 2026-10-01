package com.nice.sonar.mutation;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class CountsTest {

  private final Counts c = new Counts(30, 22, 1, 1, 5, 1, 0, 2, null, null);

  @Test
  void scoreCountsOnlyTestKillsAndTreatsUncoveredAsFailure() {
    assertThat(c.score().getAsDouble()).isEqualTo(100.0 * 22 / 30);
  }

  @Test
  void testStrengthIgnoresUncoveredMutants() {
    assertThat(c.testStrength().getAsDouble()).isEqualTo(100.0 * 22 / 27);
  }

  @Test
  void killedTotalIncludesTimeoutsAndMemoryErrors() {
    assertThat(c.killedTotal()).isEqualTo(24);
  }

  @Test
  void aliveIsSurvivedPlusNoCoverage() {
    assertThat(c.alive()).isEqualTo(6);
  }

  @Test
  void emptyCountsHaveNoScore() {
    assertThat(Counts.EMPTY.score()).isEmpty();
    assertThat(Counts.EMPTY.testStrength()).isEmpty();
  }
}
