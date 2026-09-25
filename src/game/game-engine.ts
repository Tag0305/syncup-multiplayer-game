import { GAME_CONFIG } from "../protocol/constants";
import type { AnswerState, PrivateRoomState, RevealedAnswer } from "./room-state";
import { QUESTION_BANK, QUESTION_BY_ID, type GameQuestion } from "./questions";

export type GameErrorCode =
  | "HOST_ONLY"
  | "NOT_ENOUGH_PLAYERS"
  | "INVALID_PHASE"
  | "PLAYER_NOT_ELIGIBLE"
  | "ANSWER_ALREADY_SUBMITTED"
  | "INVALID_ANSWER";

export class GameError extends Error {
  constructor(public readonly code: GameErrorCode, message: string) {
    super(message);
    this.name = "GameError";
  }
}

export function normalizeAnswer(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ")
    .replace(/^\p{P}+|\p{P}+$/gu, "")
    .trim()
    .replace(/\s+/gu, " ")
    .toLocaleLowerCase("en-US");
}

export function cleanAnswer(value: string): { rawAnswer: string; normalizedAnswer: string } {
  const rawAnswer = value.normalize("NFKC").trim().replace(/\s+/gu, " ");
  if (!rawAnswer || rawAnswer.length > GAME_CONFIG.maxAnswerLength) {
    throw new GameError("INVALID_ANSWER", `Answer must be 1–${GAME_CONFIG.maxAnswerLength} characters.`);
  }
  const normalizedAnswer = normalizeAnswer(rawAnswer);
  if (!normalizedAnswer) throw new GameError("INVALID_ANSWER", "Answer must contain letters or numbers.");
  return { rawAnswer, normalizedAnswer };
}

export function pointsForMatchSize(size: number): number {
  if (size <= 1) return 0;
  if (size === 2) return 100;
  if (size === 3) return 200;
  return 300;
}

export function selectQuestions(
  previouslyUsedIds: readonly string[],
  count = GAME_CONFIG.totalRounds,
  random: () => number = Math.random,
): GameQuestion[] {
  const used = new Set(previouslyUsedIds);
  let candidates = QUESTION_BANK.filter((question) => !used.has(question.id));
  if (candidates.length < count) candidates = [...QUESTION_BANK];
  const shuffled = [...candidates];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled.slice(0, count);
}

function activePlayers(state: PrivateRoomState) {
  return Object.values(state.players)
    .filter((player) => player.presence !== "left")
    .sort((a, b) => a.joinOrder - b.joinOrder);
}

function setTransition(
  state: PrivateRoomState,
  kind: NonNullable<PrivateRoomState["scheduledTransition"]>["kind"],
  deadline: number,
): void {
  state.phaseEndsAt = deadline;
  state.scheduledTransition = { kind, deadline, phaseVersion: state.phaseVersion };
}

function beginQuestion(state: PrivateRoomState, roundNumber: number, now: number): void {
  const questionId = state.selectedQuestionIds[roundNumber - 1];
  const question = QUESTION_BY_ID.get(questionId);
  if (!question) throw new Error("Selected question is missing from the question bank");
  state.roundNumber = roundNumber;
  state.phase = "question";
  state.status = "playing";
  state.currentQuestion = question;
  state.eligiblePlayerIds = state.gamePlayerIds.filter((id) => state.players[id]?.presence !== "left");
  state.answers = {};
  state.lastRoundPoints = {};
  for (const player of Object.values(state.players)) player.currentAnswerStatus = "not_submitted";
  state.phaseVersion += 1;
  state.phaseStartedAt = now;
  setTransition(state, "answer_deadline", now + GAME_CONFIG.answerDurationMs);
  state.updatedAt = now;
  state.eventSequence += 1;
}

export function startGame(state: PrivateRoomState, playerId: string, now: number): void {
  if (state.hostPlayerId !== playerId) throw new GameError("HOST_ONLY", "Only the host can start the game.");
  if (state.phase !== "lobby" || state.status !== "lobby") throw new GameError("INVALID_PHASE", "The game has already started.");
  const players = activePlayers(state);
  if (players.length < GAME_CONFIG.minPlayers) throw new GameError("NOT_ENOUGH_PLAYERS", "At least two players are required.");
  const questions = selectQuestions(state.usedQuestionIds);
  state.gameNumber += 1;
  state.gamePlayerIds = players.map((player) => player.playerId);
  state.selectedQuestionIds = questions.map((question) => question.id);
  state.usedQuestionIds = [...new Set([...state.usedQuestionIds, ...state.selectedQuestionIds])];
  state.roundResults = [];
  state.scoredPhaseVersions = [];
  for (const player of players) {
    player.score = 0;
    player.roundsAnswered = 0;
    player.matchedRounds = 0;
  }
  beginQuestion(state, 1, now);
}

export function submitAnswer(state: PrivateRoomState, playerId: string, answer: string, now: number): boolean {
  if (state.phase !== "question") throw new GameError("INVALID_PHASE", "Answers are not being accepted right now.");
  if (!state.eligiblePlayerIds.includes(playerId) || state.players[playerId]?.presence === "left") {
    throw new GameError("PLAYER_NOT_ELIGIBLE", "You are not eligible to answer this round.");
  }
  if (state.answers[playerId] || state.players[playerId].currentAnswerStatus === "submitted") {
    throw new GameError("ANSWER_ALREADY_SUBMITTED", "Your answer is already locked in.");
  }
  const cleaned = cleanAnswer(answer);
  state.answers[playerId] = {
    playerId,
    ...cleaned,
    submittedAt: now,
    phaseVersion: state.phaseVersion,
  } satisfies AnswerState;
  state.players[playerId].currentAnswerStatus = "submitted";
  state.players[playerId].roundsAnswered += 1;
  state.updatedAt = now;
  state.eventSequence += 1;
  return allRequiredAnswersSubmitted(state);
}

export function allRequiredAnswersSubmitted(state: PrivateRoomState): boolean {
  const required = state.eligiblePlayerIds.filter((id) => state.players[id]?.presence !== "left");
  return required.length > 0 && required.every((id) => Boolean(state.answers[id]));
}

export function revealAnswers(state: PrivateRoomState, now: number, expectedPhaseVersion = state.phaseVersion): boolean {
  if (state.phase !== "question" || state.phaseVersion !== expectedPhaseVersion) return false;
  if (state.scoredPhaseVersions.includes(expectedPhaseVersion)) return false;
  const groups = new Map<string, AnswerState[]>();
  for (const answer of Object.values(state.answers)) {
    if (answer.phaseVersion !== expectedPhaseVersion || !state.eligiblePlayerIds.includes(answer.playerId)) continue;
    const group = groups.get(answer.normalizedAnswer) ?? [];
    group.push(answer);
    groups.set(answer.normalizedAnswer, group);
  }
  const revealedAnswers: RevealedAnswer[] = state.eligiblePlayerIds.map((playerId) => {
    const player = state.players[playerId];
    const answer = state.answers[playerId];
    if (!answer) {
      if (player) player.currentAnswerStatus = "timed_out";
      state.lastRoundPoints[playerId] = 0;
      return { playerId, nickname: player?.nickname ?? "Player", answer: "No answer", matchSize: 0, pointsAwarded: 0, normalizedGroup: null };
    }
    const matchSize = groups.get(answer.normalizedAnswer)?.length ?? 1;
    const pointsAwarded = pointsForMatchSize(matchSize);
    if (player) {
      player.score += pointsAwarded;
      if (pointsAwarded > 0) player.matchedRounds += 1;
    }
    state.lastRoundPoints[playerId] = pointsAwarded;
    return { playerId, nickname: player?.nickname ?? "Player", answer: answer.rawAnswer, matchSize, pointsAwarded, normalizedGroup: answer.normalizedAnswer };
  });
  state.scoredPhaseVersions.push(expectedPhaseVersion);
  state.roundResults.push({
    roundNumber: state.roundNumber,
    questionId: state.currentQuestion?.id ?? "unknown",
    revealedAnswers,
    scoredAt: now,
    scoredPhaseVersion: expectedPhaseVersion,
  });
  state.phase = "reveal";
  state.phaseVersion += 1;
  state.phaseStartedAt = now;
  setTransition(state, "reveal_fallback", now + GAME_CONFIG.revealDurationMs);
  state.updatedAt = now;
  state.eventSequence += 1;
  return true;
}

export function advancePhase(state: PrivateRoomState, now: number): boolean {
  if (state.phase === "reveal") {
    state.phase = "leaderboard";
    state.phaseVersion += 1;
    state.phaseStartedAt = now;
    setTransition(state, "leaderboard_fallback", now + GAME_CONFIG.hostFallbackMs);
  } else if (state.phase === "leaderboard") {
    if (state.roundNumber >= state.totalRounds) {
      state.phase = "final";
      state.status = "finished";
      state.phaseVersion += 1;
      state.phaseStartedAt = now;
      state.phaseEndsAt = null;
      state.scheduledTransition = null;
    } else {
      beginQuestion(state, state.roundNumber + 1, now);
      return true;
    }
  } else {
    return false;
  }
  state.updatedAt = now;
  state.eventSequence += 1;
  return true;
}

export function playAgain(state: PrivateRoomState, playerId: string, now: number): void {
  if (state.hostPlayerId !== playerId) throw new GameError("HOST_ONLY", "Only the host can start another game.");
  if (state.phase !== "final" || state.status !== "finished") throw new GameError("INVALID_PHASE", "Play Again is available after the final results.");
  const players = activePlayers(state);
  if (players.length < GAME_CONFIG.minPlayers) throw new GameError("NOT_ENOUGH_PLAYERS", "At least two players are required.");
  const questions = selectQuestions(state.usedQuestionIds);
  state.gameNumber += 1;
  state.gamePlayerIds = players.map((player) => player.playerId);
  state.selectedQuestionIds = questions.map((question) => question.id);
  state.usedQuestionIds = [...new Set([...state.usedQuestionIds, ...state.selectedQuestionIds])];
  state.roundResults = [];
  state.scoredPhaseVersions = [];
  state.answers = {};
  for (const player of players) {
    player.score = 0;
    player.roundsAnswered = 0;
    player.matchedRounds = 0;
    player.currentAnswerStatus = "not_submitted";
  }
  beginQuestion(state, 1, now);
}

export function handleScheduledTransition(state: PrivateRoomState, now: number): boolean {
  const scheduled = state.scheduledTransition;
  if (!scheduled || scheduled.phaseVersion !== state.phaseVersion || scheduled.deadline > now) return false;
  if (scheduled.kind === "answer_deadline") return revealAnswers(state, now, scheduled.phaseVersion);
  if (scheduled.kind === "reveal_fallback" && state.phase === "reveal") return advancePhase(state, now);
  if (scheduled.kind === "leaderboard_fallback" && state.phase === "leaderboard") return advancePhase(state, now);
  return false;
}
