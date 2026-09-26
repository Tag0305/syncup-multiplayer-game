import { GAME_CONFIG } from "../protocol/constants";
import type { AnswerState, HostQuestionState, PrivateRoomState, RevealedAnswer } from "./room-state";

export type GameErrorCode =
  | "HOST_ONLY"
  | "SETUP_INCOMPLETE"
  | "SETUP_LOCKED"
  | "NOT_ENOUGH_PLAYERS"
  | "INVALID_PHASE"
  | "PLAYER_NOT_ELIGIBLE"
  | "ANSWER_ALREADY_SUBMITTED"
  | "INVALID_ANSWER"
  | "INVALID_QUESTION";

export class GameError extends Error {
  constructor(public readonly code: GameErrorCode, message: string) {
    super(message);
    this.name = "GameError";
  }
}

export interface HostSetupInput {
  question: string;
  answer: string;
  acceptedAnswers?: readonly string[];
}

const OUTER_PUNCTUATION = /^\p{P}+|\p{P}+$/gu;
const WORD_PATTERN = /[\p{L}\p{N}]+/gu;
const PARTIAL_STOP_WORDS = new Set(["a", "an", "and", "at", "for", "in", "is", "my", "of", "on", "or", "the", "to", "with"]);
const MIN_PARTIAL_CHARACTERS = 5;

function canonicalizePunctuation(value: string): string {
  return value
    .replace(/[‘’‚‛]/gu, "'")
    .replace(/[“”„‟]/gu, "\"")
    .replace(/[‐‑‒–—―]/gu, "-");
}

export function normalizeAnswer(value: string): string {
  return canonicalizePunctuation(value.normalize("NFKC"))
    .trim()
    .replace(/\s+/gu, " ")
    .replace(OUTER_PUNCTUATION, "")
    .trim()
    .replace(/\s+/gu, " ")
    .toLocaleLowerCase("en-US");
}

function answerTokens(normalizedAnswer: string): string[] {
  return normalizedAnswer.match(WORD_PATTERN) ?? [];
}

function hasMeaningfulPartial(tokens: readonly string[]): boolean {
  const characters = tokens.reduce((total, token) => total + Array.from(token).length, 0);
  return characters >= MIN_PARTIAL_CHARACTERS && tokens.some((token) => !PARTIAL_STOP_WORDS.has(token));
}

function containsContiguousWords(
  acceptedTokens: readonly string[],
  playerTokens: readonly string[],
  wordsMatch: (acceptedWord: string, playerWord: string) => boolean,
): boolean {
  if (playerTokens.length === 0 || playerTokens.length > acceptedTokens.length) return false;
  for (let offset = 0; offset <= acceptedTokens.length - playerTokens.length; offset += 1) {
    if (playerTokens.every((token, index) => wordsMatch(acceptedTokens[offset + index], token))) return true;
  }
  return false;
}

export function damerauLevenshtein(left: string, right: string): number {
  const source = Array.from(left);
  const target = Array.from(right);
  const distance = Array.from({ length: source.length + 1 }, () => Array<number>(target.length + 1).fill(0));
  for (let index = 0; index <= source.length; index += 1) distance[index][0] = index;
  for (let index = 0; index <= target.length; index += 1) distance[0][index] = index;
  for (let sourceIndex = 1; sourceIndex <= source.length; sourceIndex += 1) {
    for (let targetIndex = 1; targetIndex <= target.length; targetIndex += 1) {
      const substitutionCost = source[sourceIndex - 1] === target[targetIndex - 1] ? 0 : 1;
      distance[sourceIndex][targetIndex] = Math.min(
        distance[sourceIndex - 1][targetIndex] + 1,
        distance[sourceIndex][targetIndex - 1] + 1,
        distance[sourceIndex - 1][targetIndex - 1] + substitutionCost,
      );
      if (
        sourceIndex > 1
        && targetIndex > 1
        && source[sourceIndex - 1] === target[targetIndex - 2]
        && source[sourceIndex - 2] === target[targetIndex - 1]
      ) {
        distance[sourceIndex][targetIndex] = Math.min(
          distance[sourceIndex][targetIndex],
          distance[sourceIndex - 2][targetIndex - 2] + 1,
        );
      }
    }
  }
  return distance[source.length][target.length];
}

function wordsMatchWithTypoTolerance(acceptedWord: string, playerWord: string): boolean {
  if (acceptedWord === playerWord) return true;
  const shortestLength = Math.min(Array.from(acceptedWord).length, Array.from(playerWord).length);
  const maximumEdits = shortestLength <= 4 ? 0 : shortestLength <= 8 ? 1 : 2;
  if (maximumEdits === 0 || Math.abs(Array.from(acceptedWord).length - Array.from(playerWord).length) > maximumEdits) return false;
  return damerauLevenshtein(acceptedWord, playerWord) <= maximumEdits;
}

function isSafeWholeWordPartial(playerAnswer: string, acceptedAnswer: string): boolean {
  const playerTokens = answerTokens(playerAnswer);
  const acceptedTokens = answerTokens(acceptedAnswer);
  if (playerTokens.length >= acceptedTokens.length || !hasMeaningfulPartial(playerTokens)) return false;
  return containsContiguousWords(acceptedTokens, playerTokens, (accepted, player) => accepted === player);
}

function isTypoTolerantMatch(playerAnswer: string, acceptedAnswer: string): boolean {
  const playerTokens = answerTokens(playerAnswer);
  const acceptedTokens = answerTokens(acceptedAnswer);
  if (playerTokens.length === 0 || playerTokens.length > acceptedTokens.length) return false;
  if (playerTokens.length < acceptedTokens.length && !hasMeaningfulPartial(playerTokens)) return false;
  return containsContiguousWords(acceptedTokens, playerTokens, wordsMatchWithTypoTolerance);
}

export type AnswerMatchKind = "exact" | "partial" | "typo";

export function classifyAnswerMatch(playerAnswer: string, acceptedAnswers: readonly string[]): AnswerMatchKind | null {
  if (acceptedAnswers.some((accepted) => playerAnswer === accepted)) return "exact";
  if (acceptedAnswers.some((accepted) => isSafeWholeWordPartial(playerAnswer, accepted))) return "partial";
  if (acceptedAnswers.some((accepted) => isTypoTolerantMatch(playerAnswer, accepted))) return "typo";
  return null;
}

export function cleanAnswer(value: string): { rawAnswer: string; normalizedAnswer: string } {
  const rawAnswer = value.normalize("NFKC").trim().replace(/\s+/gu, " ");
  if (!rawAnswer || rawAnswer.length > GAME_CONFIG.maxAnswerLength || /[\u0000-\u001F\u007F\u202A-\u202E\u2066-\u2069]/u.test(rawAnswer)) {
    throw new GameError("INVALID_ANSWER", `Answer must be 1 to ${GAME_CONFIG.maxAnswerLength} characters.`);
  }
  const normalizedAnswer = normalizeAnswer(rawAnswer);
  if (!normalizedAnswer) throw new GameError("INVALID_ANSWER", "Answer must contain letters or numbers.");
  return { rawAnswer, normalizedAnswer };
}

export function cleanQuestion(value: string): string {
  const question = value.normalize("NFKC").trim().replace(/\s+/gu, " ");
  if (!question || question.length > GAME_CONFIG.maxQuestionLength || /[\u0000-\u001F\u007F\u202A-\u202E\u2066-\u2069]/u.test(question)) {
    throw new GameError("INVALID_QUESTION", `Question must be 1 to ${GAME_CONFIG.maxQuestionLength} visible characters.`);
  }
  return question;
}

function assertHost(state: PrivateRoomState, playerId: string): void {
  if (state.originalHostPlayerId !== playerId) throw new GameError("HOST_ONLY", "Only the original host can do that.");
}

function prepareHostQuestions(input: readonly HostSetupInput[]): HostQuestionState[] {
  if (input.length !== GAME_CONFIG.totalRounds) {
    throw new GameError("SETUP_INCOMPLETE", "Complete exactly five questions and secret answers.");
  }
  return input.map((pair, index) => {
    const aliases = pair.acceptedAnswers ?? [];
    if (aliases.length >= GAME_CONFIG.maxAcceptedAnswers) {
      throw new GameError("INVALID_ANSWER", `Use no more than ${GAME_CONFIG.maxAcceptedAnswers - 1} alternative answers per question.`);
    }
    const primaryAnswer = cleanAnswer(pair.answer);
    const seenAnswers = new Set([primaryAnswer.normalizedAnswer]);
    const acceptedAlternatives = aliases
      .map(cleanAnswer)
      .filter((answer) => {
        if (seenAnswers.has(answer.normalizedAnswer)) return false;
        seenAnswers.add(answer.normalizedAnswer);
        return true;
      });
    return {
      id: `host-question-${index + 1}`,
      question: cleanQuestion(pair.question),
      primaryAnswer,
      acceptedAlternatives,
    };
  });
}

export function saveHostSetup(state: PrivateRoomState, playerId: string, input: readonly HostSetupInput[], now: number): void {
  assertHost(state, playerId);
  if (state.phase !== "setup" || state.status !== "lobby") throw new GameError("INVALID_PHASE", "Game setup is not available now.");
  if (state.setupStatus === "locked") throw new GameError("SETUP_LOCKED", "Questions and answers are already locked.");
  state.hostQuestions = prepareHostQuestions(input);
  state.phaseVersion += 1;
  state.updatedAt = now;
  state.eventSequence += 1;
}

export function lockHostSetup(state: PrivateRoomState, playerId: string, now: number): void {
  assertHost(state, playerId);
  if (state.phase !== "setup" || state.status !== "lobby") throw new GameError("INVALID_PHASE", "Game setup cannot be locked now.");
  if (state.setupStatus === "locked") return;
  if (state.hostQuestions.length !== GAME_CONFIG.totalRounds) {
    throw new GameError("SETUP_INCOMPLETE", "Complete and review all five questions and secret answers before locking.");
  }
  state.setupStatus = "locked";
  state.phase = "lobby";
  state.phaseVersion += 1;
  state.updatedAt = now;
  state.eventSequence += 1;
}

function competingPlayers(state: PrivateRoomState) {
  return Object.values(state.players)
    .filter((player) => player.role === "player" && player.presence !== "left")
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
  const lockedQuestion = state.hostQuestions[roundNumber - 1];
  if (!lockedQuestion) throw new Error("Locked host question is missing");
  state.roundNumber = roundNumber;
  state.phase = "question";
  state.status = "playing";
  state.currentQuestion = { id: lockedQuestion.id, text: lockedQuestion.question };
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
  assertHost(state, playerId);
  if (state.phase !== "lobby" || state.status !== "lobby") throw new GameError("INVALID_PHASE", "The game cannot start from this screen.");
  if (state.setupStatus !== "locked" || state.hostQuestions.length !== GAME_CONFIG.totalRounds) {
    throw new GameError("SETUP_INCOMPLETE", "Lock all five questions and answers before starting.");
  }
  const players = competingPlayers(state);
  if (!players.some((player) => player.presence === "connected")) {
    throw new GameError("NOT_ENOUGH_PLAYERS", "At least one participating player must be connected.");
  }
  state.gameNumber += 1;
  state.gamePlayerIds = players.map((player) => player.playerId);
  state.roundResults = [];
  state.scoredPhaseVersions = [];
  state.answers = {};
  for (const player of Object.values(state.players)) {
    player.score = 0;
    player.roundsAnswered = 0;
    player.matchedRounds = 0;
    player.currentAnswerStatus = "not_submitted";
  }
  beginQuestion(state, 1, now);
}

export function submitAnswer(state: PrivateRoomState, playerId: string, answer: string, now: number): boolean {
  if (state.phase !== "question") throw new GameError("INVALID_PHASE", "Answers are not being accepted right now.");
  if (state.phaseEndsAt === null || now >= state.phaseEndsAt) {
    throw new GameError("INVALID_PHASE", "Answer time has expired.");
  }
  const player = state.players[playerId];
  if (!player || player.role !== "player" || !state.eligiblePlayerIds.includes(playerId) || player.presence === "left") {
    throw new GameError("PLAYER_NOT_ELIGIBLE", "Only participating players can answer this round.");
  }
  if (state.answers[playerId] || player.currentAnswerStatus === "submitted") {
    throw new GameError("ANSWER_ALREADY_SUBMITTED", "Your answer is already locked in.");
  }
  const cleaned = cleanAnswer(answer);
  state.answers[playerId] = { playerId, ...cleaned, submittedAt: now, phaseVersion: state.phaseVersion } satisfies AnswerState;
  player.currentAnswerStatus = "submitted";
  player.roundsAnswered += 1;
  state.updatedAt = now;
  state.eventSequence += 1;
  return allRequiredAnswersSubmitted(state);
}

export function allRequiredAnswersSubmitted(state: PrivateRoomState): boolean {
  const required = state.eligiblePlayerIds.filter((id) => state.players[id]?.presence !== "left");
  return required.every((id) => Boolean(state.answers[id]));
}

export function revealAnswers(state: PrivateRoomState, now: number, expectedPhaseVersion = state.phaseVersion): boolean {
  if (state.phase !== "question" || state.phaseVersion !== expectedPhaseVersion) return false;
  if (state.scoredPhaseVersions.includes(expectedPhaseVersion)) return false;
  const hostQuestion = state.hostQuestions[state.roundNumber - 1];
  if (!hostQuestion) throw new Error("Host answer is missing for current round");

  const revealedAnswers: RevealedAnswer[] = state.eligiblePlayerIds.map((playerId) => {
    const player = state.players[playerId];
    const answer = state.answers[playerId];
    if (!answer) {
      if (player) player.currentAnswerStatus = "timed_out";
      state.lastRoundPoints[playerId] = 0;
      return { playerId, nickname: player?.nickname ?? "Player", answer: "No answer", matched: false, pointsAwarded: 0 };
    }
    const acceptedAnswers = [
      hostQuestion.primaryAnswer.normalizedAnswer,
      ...hostQuestion.acceptedAlternatives.map((accepted) => accepted.normalizedAnswer),
    ];
    const matched = classifyAnswerMatch(answer.normalizedAnswer, acceptedAnswers) !== null;
    const pointsAwarded = matched ? 100 : 0;
    if (player) {
      player.score += pointsAwarded;
      if (matched) player.matchedRounds += 1;
    }
    state.lastRoundPoints[playerId] = pointsAwarded;
    return { playerId, nickname: player?.nickname ?? "Player", answer: answer.rawAnswer, matched, pointsAwarded };
  });

  state.scoredPhaseVersions.push(expectedPhaseVersion);
  state.roundResults.push({
    roundNumber: state.roundNumber,
    questionId: hostQuestion.id,
    hostAnswer: hostQuestion.primaryAnswer.rawAnswer,
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

export function setUpAnotherGame(state: PrivateRoomState, playerId: string, now: number): void {
  assertHost(state, playerId);
  if (state.phase !== "final" || state.status !== "finished") {
    throw new GameError("INVALID_PHASE", "Another game can be prepared after final results.");
  }
  state.status = "lobby";
  state.phase = "setup";
  state.setupStatus = "editing";
  state.hostQuestions = [];
  state.roundNumber = 0;
  state.phaseVersion += 1;
  state.phaseStartedAt = null;
  state.phaseEndsAt = null;
  state.currentQuestion = null;
  state.gamePlayerIds = [];
  state.eligiblePlayerIds = [];
  state.answers = {};
  state.roundResults = [];
  state.scoredPhaseVersions = [];
  state.lastRoundPoints = {};
  state.scheduledTransition = null;
  for (const player of Object.values(state.players)) {
    player.score = 0;
    player.roundsAnswered = 0;
    player.matchedRounds = 0;
    player.currentAnswerStatus = "not_submitted";
  }
  state.updatedAt = now;
  state.eventSequence += 1;
}

export function handleScheduledTransition(state: PrivateRoomState, now: number): boolean {
  const scheduled = state.scheduledTransition;
  if (!scheduled || scheduled.phaseVersion !== state.phaseVersion || scheduled.deadline > now) return false;
  if (scheduled.kind === "answer_deadline") return revealAnswers(state, now, scheduled.phaseVersion);
  if (scheduled.kind === "reveal_fallback" && state.phase === "reveal") return advancePhase(state, now);
  if (scheduled.kind === "leaderboard_fallback" && state.phase === "leaderboard") return advancePhase(state, now);
  return false;
}
