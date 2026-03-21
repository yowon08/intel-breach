import { useEffect, useMemo, useRef, useState } from "react";
import { rooms, corridorSegments, startRooms, roomMap } from "./data/mapData";

type ViewMode = "map" | "tablet";
type GamePhase = "boot" | "playing" | "dying" | "escaped";

type DetectionResult = {
  visible: boolean;
  roomId: string | null;
  fakeRoomIds: string[];
};

type ProgressState = {
  A: number;
  B: number;
  C: number;
};

type SameRoomCause = "playerEnteredEnemyRoom" | "enemyEnteredPlayerRoom" | null;
type EnemyMode = "wander" | "alerted" | "attackWindup";

const ROOM_WIDTH = 100;
const ROOM_HEIGHT = 70;
const GAP_X = 140;
const GAP_Y = 120;
const BOARD_WIDTH = 560;
const BOARD_HEIGHT = 360;

const MAP_WIDTH = ROOM_WIDTH + 3 * GAP_X;
const MAP_HEIGHT = ROOM_HEIGHT + 2 * GAP_Y;

const OFFSET_X = (BOARD_WIDTH - MAP_WIDTH) / 2;
const OFFSET_Y = (BOARD_HEIGHT - MAP_HEIGHT) / 2;

const TASK_SPEED_PER_SEC = 100 / 20;
const SCAN_TIME = 2000;
const ESCAPE_TIME = 4000;
const MOVE_TIME = 3200;

const WANDER_MIN = 6000;
const WANDER_MAX = 10000;
const ALERT_MIN = 10000;
const ALERT_MAX = 16000;
const ATTACK_WINDUP_MIN = 10000;
const ATTACK_WINDUP_MAX = 15000;
const ALERT_MEMORY = 30000;

const BEHIND_START_ROOMS = ["R4", "R8", "R12"];
const ESCAPE_LINES = ["정보 수집 성공함.", "복귀.", "S3CUR3D"];

function randomOf<T>(arr: T[]) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomBetween(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getSafeInitialBehind(playerId: string) {
  const candidates = BEHIND_START_ROOMS.filter((id) => id !== playerId);
  return randomOf(candidates.length > 0 ? candidates : BEHIND_START_ROOMS);
}

function getDistance(startId: string, goalId: string) {
  if (startId === goalId) return 0;

  const queue: Array<{ id: string; dist: number }> = [{ id: startId, dist: 0 }];
  const visited = new Set<string>([startId]);

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const next of roomMap[current.id].neighbors) {
      if (visited.has(next)) continue;
      if (next === goalId) return current.dist + 1;
      visited.add(next);
      queue.push({ id: next, dist: current.dist + 1 });
    }
  }

  return 999;
}

function getCloserNeighbor(fromId: string, targetId: string) {
  const neighbors = roomMap[fromId].neighbors;
  const scored = neighbors.map((id) => ({
    id,
    dist: getDistance(id, targetId),
  }));
  scored.sort((a, b) => a.dist - b.dist);
  const bestDist = scored[0].dist;
  const candidates = scored.filter((x) => x.dist === bestDist).map((x) => x.id);
  return randomOf(candidates);
}

function getTaskKeyByRoom(roomId: string): keyof ProgressState | null {
  const type = roomMap[roomId].type;
  if (type === "dataA") return "A";
  if (type === "dataB") return "B";
  if (type === "dataC") return "C";
  return null;
}

function allTasksDone(progress: ProgressState) {
  return progress.A >= 100 && progress.B >= 100 && progress.C >= 100;
}

function totalProgress(progress: ProgressState) {
  return Math.floor((progress.A + progress.B + progress.C) / 3);
}

export default function App() {
  const initialPlayer = useMemo(() => randomOf(startRooms), []);
  const initialBehind = useMemo(() => getSafeInitialBehind(initialPlayer), [initialPlayer]);

  const [phase, setPhase] = useState<GamePhase>("boot");
  const [fadeIn, setFadeIn] = useState(true);

  const [viewMode, setViewMode] = useState<ViewMode>("map");
  const [playerRoom, setPlayerRoom] = useState(initialPlayer);
  const [behindRoom, setBehindRoom] = useState(initialBehind);

  const [isMoving, setIsMoving] = useState(false);
  const [moveTarget, setMoveTarget] = useState<string | null>(null);

  const [progress, setProgress] = useState<ProgressState>({ A: 0, B: 0, C: 0 });

  const [statusText, setStatusText] = useState("환풍구 안 공기가 눅눅하다.");
  const [dangerText, setDangerText] = useState("탐지 없이는 위치를 특정할 수 없다.");

  const [isScanning, setIsScanning] = useState(false);
  const [scanReady, setScanReady] = useState(true);
  const [detection, setDetection] = useState<DetectionResult>({
    visible: false,
    roomId: null,
    fakeRoomIds: [],
  });

  const [sameRoomCause, setSameRoomCause] = useState<SameRoomCause>(null);

  const [enemyMode, setEnemyMode] = useState<EnemyMode>("wander");
  const [enemyAlertUntil, setEnemyAlertUntil] = useState<number | null>(null);

  const [escapeActive, setEscapeActive] = useState(false);
  const [escapeStartedAt, setEscapeStartedAt] = useState<number | null>(null);

  const [meltdownTriggered, setMeltdownTriggered] = useState(false);
  const [meltdownResolved, setMeltdownResolved] = useState(false);
  const [meltdownVisual, setMeltdownVisual] = useState(false);

  const [screenStatic, setScreenStatic] = useState(false);
  const [deathFade, setDeathFade] = useState(false);
  const [escapeBlueFade, setEscapeBlueFade] = useState(false);
  const [escapeWhiteFade, setEscapeWhiteFade] = useState(false);

  const [deathDistort, setDeathDistort] = useState(false);
  const [roomRevealBlackout, setRoomRevealBlackout] = useState(false);
  const [deathPending, setDeathPending] = useState(false);

  const [escapeTypedLines, setEscapeTypedLines] = useState<string[]>(["", "", ""]);

  const escapeAudioRef = useRef<HTMLAudioElement | null>(null);
  const scanAudioRef = useRef<HTMLAudioElement | null>(null);
  const chargeAudioRef = useRef<HTMLAudioElement | null>(null);
  const chargeRoomRef = useRef<string | null>(null);
  const chargeTimeByRoomRef = useRef<Record<string, number>>({});
  const prevProgressRef = useRef<ProgressState>({ A: 0, B: 0, C: 0 });

  const playerRoomRef = useRef(playerRoom);
  const behindRoomRef = useRef(behindRoom);
  const phaseRef = useRef(phase);
  const sameRoomCauseRef = useRef<SameRoomCause>(sameRoomCause);
  const enemyModeRef = useRef<EnemyMode>(enemyMode);
  const enemyAlertUntilRef = useRef<number | null>(enemyAlertUntil);
  const viewModeRef = useRef<ViewMode>(viewMode);
  const deathPendingRef = useRef(false);

  const moveTimerRef = useRef<number | null>(null);
  const enemyTimerRef = useRef<number | null>(null);
  const escapeTimerRef = useRef<number | null>(null);
  const switchStaticTimerRef = useRef<number | null>(null);
  const typingTimersRef = useRef<number[]>([]);
  const revealTimerRef = useRef<number | null>(null);
  const deathSequenceTimerRefs = useRef<number[]>([]);
  const ventStopRef = useRef<null | (() => void)>(null);
  const rafRef = useRef<number | null>(null);
  const lastFrameRef = useRef(performance.now());

  const hasViewModeMountedRef = useRef(false);
  const bgmRef = useRef<HTMLAudioElement | null>(null);

  const currentRoom = roomMap[playerRoom];
  const finished = allTasksDone(progress);
  const overallProgress = totalProgress(progress);
  const currentTaskKey = getTaskKeyByRoom(playerRoom);

  const isTabletCollecting =
    phase === "playing" &&
    viewMode === "tablet" &&
    !isMoving &&
    !isScanning &&
    !escapeActive &&
    !deathPending &&
    !sameRoomCause &&
    !!currentTaskKey &&
    progress[currentTaskKey] < 100;

  const escapeSeconds =
    escapeStartedAt == null
      ? 0
      : Math.max(0, Math.ceil((ESCAPE_TIME - (Date.now() - escapeStartedAt)) / 1000));

  useEffect(() => {
    playerRoomRef.current = playerRoom;
  }, [playerRoom]);

  useEffect(() => {
    behindRoomRef.current = behindRoom;
  }, [behindRoom]);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    sameRoomCauseRef.current = sameRoomCause;
  }, [sameRoomCause]);

  useEffect(() => {
    enemyModeRef.current = enemyMode;
  }, [enemyMode]);

  useEffect(() => {
    enemyAlertUntilRef.current = enemyAlertUntil;
  }, [enemyAlertUntil]);

  useEffect(() => {
    viewModeRef.current = viewMode;
  }, [viewMode]);

  useEffect(() => {
    deathPendingRef.current = deathPending;
  }, [deathPending]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setPhase("playing");
      setTimeout(() => setFadeIn(false), 50);
    }, 200);

    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    const bgm = new Audio("/sounds/theme.mp3");
    bgm.loop = true;
    bgm.volume = 0.32;
    bgm.preload = "auto";
    bgmRef.current = bgm;

    return () => {
      bgm.pause();
      bgm.currentTime = 0;
    };
  }, []);

  useEffect(() => {
    if (!bgmRef.current) return;

    if (phase === "playing") {
      bgmRef.current.play().catch(() => {});
    } else {
      bgmRef.current.pause();
    }
  }, [phase]);

  useEffect(() => {
    if (phase !== "playing") return;

    const loop = () => {
      const now = performance.now();
      const delta = (now - lastFrameRef.current) / 1000;
      lastFrameRef.current = now;

      if (!isMoving && !isScanning && !deathPending && viewMode === "tablet") {
        const taskKey = getTaskKeyByRoom(playerRoomRef.current);
        if (taskKey && !sameRoomCauseRef.current) {
          setProgress((prev) => {
            const nextValue = clamp(prev[taskKey] + TASK_SPEED_PER_SEC * delta, 0, 100);
            if (nextValue !== prev[taskKey]) {
              return { ...prev, [taskKey]: nextValue };
            }
            return prev;
          });
        }
      }

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [phase, isMoving, isScanning, viewMode, deathPending]);

  useEffect(() => {
    if (phase !== "playing") return;
    if (finished) {
      setStatusText("A / B / C 데이터 확보 완료. 중앙으로 복귀하라.");
    }
  }, [finished, phase]);

  useEffect(() => {
    if (phase !== "playing") return;

    if (deathPending) {
      setDangerText("화면이 뒤틀린다. 너무 늦었다.");
      return;
    }

    if (sameRoomCause === "enemyEnteredPlayerRoom") {
      setDangerText("같은 방에 있다. 탐지를 제외한 어떤 행동도 위험하다.");
      return;
    }

    if (isScanning) {
      setDangerText("탐지기가 규칙적으로 작동 중이다");
      return;
    }

    if (enemyMode === "attackWindup") {
      setDangerText("바로 앞에서 무언가가 숨을 고른다.");
      return;
    }

    if (enemyMode === "alerted") {
      setDangerText("적이 네 위치를 의식하고 있다.");
      return;
    }

    if (viewMode === "tablet") {
      setDangerText("태블릿 잡음 속에서 데이터가 흐른다");
    } else {
      setDangerText("탐지 없이는 위치를 특정할 수 없다");
    }
  }, [sameRoomCause, isScanning, phase, viewMode, enemyMode, deathPending]);

  useEffect(() => {
    return () => cleanupTimers();
  }, []);

  useEffect(() => {
    if (!hasViewModeMountedRef.current) {
      hasViewModeMountedRef.current = true;
      return;
    }

    if (phase === "playing") {
      triggerScreenStatic(220);
    }
  }, [viewMode, phase]);

  useEffect(() => {
    if (phase !== "escaped") return;

    setEscapeTypedLines(["", "", ""]);
    setEscapeBlueFade(true);

    const timers: number[] = [];
    let accumulatedDelay = 850;

    ESCAPE_LINES.forEach((line, lineIndex) => {
      for (let i = 1; i <= line.length; i++) {
        const timer = window.setTimeout(() => {
          setEscapeTypedLines((prev) => {
            const next = [...prev];
            next[lineIndex] = line.slice(0, i);
            return next;
          });
        }, accumulatedDelay);

        timers.push(timer);
        accumulatedDelay += lineIndex === 2 ? 85 : 72;
      }

      accumulatedDelay += 500;
    });

    typingTimersRef.current = timers;

    return () => {
      timers.forEach((id) => clearTimeout(id));
    };
  }, [phase]);

  useEffect(() => {
    if (isTabletCollecting) {
      playChargeAudio(playerRoom);
    } else {
      stopChargeAudio(true);
    }
  }, [isTabletCollecting, playerRoom]);

  useEffect(() => {
    const prev = prevProgressRef.current;

    (["A", "B", "C"] as Array<keyof ProgressState>).forEach((key) => {
      if (prev[key] < 100 && progress[key] >= 100) {
        playCheckAudio();
      }
    });

    prevProgressRef.current = {
      A: progress.A,
      B: progress.B,
      C: progress.C,
    };
  }, [progress]);

  useEffect(() => {
    if (phase !== "playing") return;
    scheduleEnemyAction();

    return () => {
      if (enemyTimerRef.current) clearTimeout(enemyTimerRef.current);
    };
  }, [phase, enemyMode, enemyAlertUntil, playerRoom, behindRoom, deathPending, sameRoomCause]);

  function cleanupTimers() {
    if (moveTimerRef.current) clearTimeout(moveTimerRef.current);
    if (enemyTimerRef.current) clearTimeout(enemyTimerRef.current);
    if (escapeTimerRef.current) clearTimeout(escapeTimerRef.current);
    if (switchStaticTimerRef.current) clearTimeout(switchStaticTimerRef.current);
    if (revealTimerRef.current) clearTimeout(revealTimerRef.current);

    deathSequenceTimerRefs.current.forEach((id) => clearTimeout(id));
    deathSequenceTimerRefs.current = [];

    typingTimersRef.current.forEach((id) => clearTimeout(id));
    typingTimersRef.current = [];

    if (ventStopRef.current) {
      ventStopRef.current();
      ventStopRef.current = null;
    }

    stopScanAudio();
    stopChargeAudio(true);
    stopEscapeAudio();
  }

  function triggerScreenStatic(duration = 220) {
    setScreenStatic(true);

    if (switchStaticTimerRef.current) {
      clearTimeout(switchStaticTimerRef.current);
    }

    switchStaticTimerRef.current = window.setTimeout(() => {
      setScreenStatic(false);
    }, duration);
  }

  function stopScanAudio() {
    if (scanAudioRef.current) {
      scanAudioRef.current.pause();
      scanAudioRef.current.currentTime = 0;
      scanAudioRef.current = null;
    }
  }

  function playScanAudio() {
    stopScanAudio();

    const audio = new Audio("/sounds/scan.mp3");
    audio.loop = false;
    audio.volume = 0.9;
    audio.play().catch(() => {});
    scanAudioRef.current = audio;
  }

  function playCheck2Audio() {
    const audio = new Audio("/sounds/check2.mp3");
    audio.volume = 0.95;
    audio.play().catch(() => {});
  }

  function stopChargeAudio(savePosition = true) {
    if (chargeAudioRef.current) {
      const currentRoomId = chargeRoomRef.current;

      if (savePosition && currentRoomId) {
        chargeTimeByRoomRef.current[currentRoomId] = chargeAudioRef.current.currentTime || 0;
      }

      chargeAudioRef.current.pause();
      chargeAudioRef.current.currentTime = 0;
      chargeAudioRef.current = null;
    }

    chargeRoomRef.current = null;
  }

  function playChargeAudio(roomId: string) {
    const savedTime = chargeTimeByRoomRef.current[roomId] ?? 0;

    if (chargeAudioRef.current && chargeRoomRef.current === roomId) return;

    stopChargeAudio(true);

    const audio = new Audio("/sounds/charge.mp3");
    audio.loop = true;
    audio.volume = 0.9;
    audio.preload = "auto";

    const startPlayback = () => {
      try {
        if (savedTime > 0 && Number.isFinite(audio.duration) && audio.duration > 0) {
          const seekTime =
            savedTime >= audio.duration ? Math.max(0, audio.duration - 0.05) : savedTime;
          audio.currentTime = seekTime;
        } else if (savedTime > 0) {
          audio.currentTime = savedTime;
        }
      } catch {}

      audio.play().catch(() => {});
    };

    if (audio.readyState >= 1) {
      startPlayback();
    } else {
      audio.addEventListener("loadedmetadata", startPlayback, { once: true });
    }

    chargeAudioRef.current = audio;
    chargeRoomRef.current = roomId;
  }

  function playCheckAudio() {
    const audio = new Audio("/sounds/check.mp3");
    audio.volume = 0.95;
    audio.play().catch(() => {});
  }

  function playDieSound() {
    const audio = new Audio("/sounds/die.mp3");
    audio.volume = 1;
    audio.play().catch(() => {});
  }

  function playEscapeAudio() {
    stopEscapeAudio();

    const audio = new Audio("/sounds/escape.mp3");
    audio.loop = true;
    audio.volume = 1;
    audio.play().catch(() => {});
    escapeAudioRef.current = audio;
  }

  function stopEscapeAudio() {
    if (escapeAudioRef.current) {
      escapeAudioRef.current.pause();
      escapeAudioRef.current.currentTime = 0;
      escapeAudioRef.current = null;
    }
  }

  function ensureBgmStarted() {
    if (!bgmRef.current) return;
    if (bgmRef.current.paused) {
      bgmRef.current.play().catch(() => {});
    }
  }

  function playSpatialAudio(filePath: string, pan: number, volume: number, randomSegment = true) {
    const audio = new Audio(filePath);
    audio.loop = false;
    audio.volume = 1;
    audio.preload = "auto";

    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new AudioCtx();

    const source = ctx.createMediaElementSource(audio);
    const panner = ctx.createStereoPanner();
    const gain = ctx.createGain();

    panner.pan.setValueAtTime(pan, ctx.currentTime);
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(volume, ctx.currentTime + 0.12);

    source.connect(gain);
    gain.connect(panner);
    panner.connect(ctx.destination);

    const playNow = () => {
      try {
        if (randomSegment && Number.isFinite(audio.duration) && audio.duration > 2.5) {
          const maxStart = Math.max(0, audio.duration - 2.2);
          audio.currentTime = Math.random() * maxStart;
        }
      } catch {}
      audio.play().catch(() => {});
    };

    if (audio.readyState >= 1) {
      playNow();
    } else {
      audio.addEventListener("loadedmetadata", playNow, { once: true });
    }

    return () => {
      const now = ctx.currentTime;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(0.0001, now + 0.12);

      window.setTimeout(() => {
        audio.pause();
        audio.currentTime = 0;
        source.disconnect();
        gain.disconnect();
        panner.disconnect();
        ctx.close();
      }, 150);
    };
  }

  function playPlayerMoveAudio(pan: number) {
    return playSpatialAudio("/sounds/vent.mp3", pan, 0.16, true);
  }

  function playEnemyMoveAudio(nextRoom: string, currentPlayer: string) {
    const files = [
      "/sounds/vent2.mp3",
      "/sounds/vent3.mp3",
      "/sounds/vent4.mp3",
      "/sounds/vent5.mp3",
      "/sounds/vent6.mp3",
    ];
    const dx = roomMap[nextRoom].x - roomMap[currentPlayer].x;
    const pan = dx < 0 ? -0.8 : dx > 0 ? 0.8 : 0;
    const distance = getDistance(nextRoom, currentPlayer);
    const volume =
      distance <= 0 ? 1 :
      distance === 1 ? 0.92 :
      distance === 2 ? 0.75 :
      distance === 3 ? 0.58 : 0.42;

    return playSpatialAudio(randomOf(files), pan, volume, true);
  }

  function startDeathSequence(
    reason: string,
    options?: {
      withBlackoutReveal?: boolean;
      preRevealMs?: number;
    }
  ) {
    if (phaseRef.current !== "playing") return;
    if (deathPendingRef.current) return;

    const withBlackoutReveal = options?.withBlackoutReveal ?? false;
    const preRevealMs = options?.preRevealMs ?? 650;

    deathPendingRef.current = true;
    setDeathPending(true);

    stopScanAudio();
    stopChargeAudio(true);
    stopEscapeAudio();

    if (enemyTimerRef.current) {
      clearTimeout(enemyTimerRef.current);
      enemyTimerRef.current = null;
    }

    if (moveTimerRef.current) {
      clearTimeout(moveTimerRef.current);
      moveTimerRef.current = null;
    }

    if (ventStopRef.current) {
      ventStopRef.current();
      ventStopRef.current = null;
    }

    setIsMoving(false);
    setMoveTarget(null);
    setIsScanning(false);
    setEscapeActive(false);
    setEscapeStartedAt(null);

    const startDistortion = () => {
      setRoomRevealBlackout(false);
      setDeathDistort(true);
      setScreenStatic(true);
      setStatusText("시야가 뒤틀린다.");

      const t1 = window.setTimeout(() => {
        playDieSound();
        setDeathFade(true);
      }, 2000);

      const t2 = window.setTimeout(() => {
        if (bgmRef.current) {
          bgmRef.current.pause();
          bgmRef.current.currentTime = 0;
        }

        setPhase("dying");
        setStatusText(reason);
        setSameRoomCause(null);
        sameRoomCauseRef.current = null;
      }, 3200);

      deathSequenceTimerRefs.current.push(t1, t2);
    };

    if (withBlackoutReveal) {
      setRoomRevealBlackout(true);
      const t0 = window.setTimeout(() => {
        startDistortion();
      }, preRevealMs);
      deathSequenceTimerRefs.current.push(t0);
      return;
    }

    startDistortion();
  }

  function signalEnemyAwareness(source: "tablet" | "scan") {
    if (phaseRef.current !== "playing") return;
    if (deathPendingRef.current) return;
    if (sameRoomCauseRef.current) return;

    if (source === "tablet") {
      const dist = getDistance(playerRoomRef.current, behindRoomRef.current);
      if (dist > 2) return;
    }

    const until = Date.now() + ALERT_MEMORY;
    setEnemyMode("alerted");
    setEnemyAlertUntil(until);

    if (source === "tablet") {
      setStatusText("태블릿 잡음이 가까운 벤트 안으로 번졌다.");
    } else {
      setStatusText("탐지기의 신호가 위치를 드러냈다.");
    }
  }

  function scheduleEnemyAction() {
    if (enemyTimerRef.current) clearTimeout(enemyTimerRef.current);
    if (phaseRef.current !== "playing") return;
    if (deathPendingRef.current) return;
    if (sameRoomCauseRef.current) return;

    const currentBehind = behindRoomRef.current;
    const currentPlayer = playerRoomRef.current;
    const dist = getDistance(currentBehind, currentPlayer);

    if (enemyModeRef.current === "wander") {
      const delay = randomBetween(WANDER_MIN, WANDER_MAX);

      enemyTimerRef.current = window.setTimeout(() => {
        if (phaseRef.current !== "playing" || deathPendingRef.current || sameRoomCauseRef.current) return;

        const from = behindRoomRef.current;
        const playerNow = playerRoomRef.current;
        const neighbors = roomMap[from].neighbors;
        const nextRoom = randomOf(neighbors);

        setBehindRoom(nextRoom);
        behindRoomRef.current = nextRoom;

        const stopSound = playEnemyMoveAudio(nextRoom, playerNow);
        window.setTimeout(() => stopSound(), 760 + Math.random() * 180);

        scheduleEnemyAction();
      }, delay);

      return;
    }

    if (enemyModeRef.current === "alerted") {
      const remain = (enemyAlertUntilRef.current ?? 0) - Date.now();
      if (remain <= 0) {
        setEnemyMode("wander");
        setEnemyAlertUntil(null);
        return;
      }

      if (dist === 1) {
        setEnemyMode("attackWindup");
        setStatusText("바로 옆 방에서 무언가가 멈춰 섰다.");
        return;
      }

      const delay = randomBetween(ALERT_MIN, ALERT_MAX);

      enemyTimerRef.current = window.setTimeout(() => {
        if (phaseRef.current !== "playing" || deathPendingRef.current || sameRoomCauseRef.current) return;

        const alertRemain = (enemyAlertUntilRef.current ?? 0) - Date.now();
        if (alertRemain <= 0) {
          setEnemyMode("wander");
          setEnemyAlertUntil(null);
          return;
        }

        const from = behindRoomRef.current;
        const playerNow = playerRoomRef.current;
        const nextRoom = getCloserNeighbor(from, playerNow);

        setBehindRoom(nextRoom);
        behindRoomRef.current = nextRoom;

        const stopSound = playEnemyMoveAudio(nextRoom, playerNow);
        window.setTimeout(() => stopSound(), 760 + Math.random() * 180);

        if (getDistance(nextRoom, playerNow) === 1) {
          setEnemyMode("attackWindup");
          setStatusText("바로 인접한 방까지 접근했다.");
        } else {
          scheduleEnemyAction();
        }
      }, delay);

      return;
    }

    if (enemyModeRef.current === "attackWindup") {
      if (dist !== 1) {
        setEnemyMode("wander");
        setEnemyAlertUntil(null);
        return;
      }

      const delay = randomBetween(ATTACK_WINDUP_MIN, ATTACK_WINDUP_MAX);
      const targetRoomAtStart = playerRoomRef.current;

      enemyTimerRef.current = window.setTimeout(() => {
        if (phaseRef.current !== "playing" || deathPendingRef.current || sameRoomCauseRef.current) return;

        const stillAdjacent = getDistance(behindRoomRef.current, playerRoomRef.current) === 1;
        const playerStillThere = playerRoomRef.current === targetRoomAtStart;

        if (stillAdjacent && playerStillThere) {
          const invadedRoom = playerRoomRef.current;
          setBehindRoom(invadedRoom);
          behindRoomRef.current = invadedRoom;
          setSameRoomCause("enemyEnteredPlayerRoom");
          sameRoomCauseRef.current = "enemyEnteredPlayerRoom";
          setEnemyMode("wander");
          setEnemyAlertUntil(null);

          const stopSound = playEnemyMoveAudio(invadedRoom, invadedRoom);
          window.setTimeout(() => stopSound(), 900);

          setStatusText("바로 안으로 들어왔다. 숨을 참아도 늦었다.");
          return;
        }

        setEnemyMode("wander");
        setEnemyAlertUntil(null);
        setStatusText("기척이 멀어졌다.");
      }, delay);
    }
  }

  function requestViewMode(nextMode: ViewMode) {
    ensureBgmStarted();

    if (phase !== "playing") return;
    if (isMoving || isScanning || escapeActive || deathPending) return;
    if (viewMode === nextMode) return;

    if (sameRoomCause === "enemyEnteredPlayerRoom") {
      startDeathSequence("같은 방 안에서 화면을 건드린 순간, 뒤늦게 모든 것이 끝났다.");
      return;
    }

    setViewMode(nextMode);

    if (nextMode === "tablet") {
      signalEnemyAwareness("tablet");
    }
  }

  function handleMove(targetId: string) {
    ensureBgmStarted();

    if (phase !== "playing") return;
    if (isMoving || isScanning || escapeActive || deathPending) return;

    if (sameRoomCause === "enemyEnteredPlayerRoom") {
      startDeathSequence("같은 방 안에서 움직이려던 순간, 바로 옆의 기척이 덮쳐 왔다.");
      return;
    }

    const current = rooms.find((r) => r.id === playerRoom);
    if (!current) return;
    if (!current.neighbors.includes(targetId)) return;

    const target = rooms.find((r) => r.id === targetId);
    if (!target) return;

    setDetection({
      visible: false,
      roomId: null,
      fakeRoomIds: [],
    });

    setIsMoving(true);
    setMoveTarget(targetId);
    setStatusText("좁은 환풍구를 조심스럽게 기어간다.");

    const dx = target.x - current.x;
    const pan = dx < 0 ? -0.8 : dx > 0 ? 0.8 : 0;

    const stopSound = playPlayerMoveAudio(pan);
    ventStopRef.current = stopSound;

    moveTimerRef.current = window.setTimeout(() => {
      stopSound();
      ventStopRef.current = null;

      setPlayerRoom(targetId);
      playerRoomRef.current = targetId;

      setIsMoving(false);
      setMoveTarget(null);

      const overlappedNow = targetId === behindRoomRef.current;

      if (overlappedNow) {
        setSameRoomCause("playerEnteredEnemyRoom");
        sameRoomCauseRef.current = "playerEnteredEnemyRoom";
        startDeathSequence("적이 있던 방으로 몸을 밀어 넣는 순간, 붉은 잡음과 함께 연결이 끊겼다.");
      } else {
        setStatusText(roomMap[targetId].flavor ?? "금속 표면이 미세하게 울린다.");
      }
    }, MOVE_TIME);
  }

  function handleScan() {
    ensureBgmStarted();

    if (phase !== "playing") return;
    if (viewMode !== "map") return;
    if (!scanReady || isScanning || isMoving || escapeActive || deathPending) return;

    setIsScanning(true);
    setScanReady(false);
    setStatusText("탐지기가 규칙적으로 삑-삑-삑 울린다.");
    playScanAudio();

    window.setTimeout(() => {
      signalEnemyAwareness("scan");

      if (finished && !meltdownTriggered) {
        const fakeRoomIds = rooms
          .map((r) => r.id)
          .filter((id) => id !== behindRoomRef.current)
          .sort(() => Math.random() - 0.5)
          .slice(0, 5);

        setMeltdownTriggered(true);
        setMeltdownVisual(true);
        setDetection({
          visible: false,
          roomId: null,
          fakeRoomIds,
        });
        setStatusText("신호 폭주. 맵 전역에 이상 응답이 퍼진다.");
      } else if (meltdownTriggered && !meltdownResolved) {
        const dist = getDistance(playerRoomRef.current, behindRoomRef.current);
        setMeltdownResolved(true);
        setMeltdownVisual(false);
        setDetection({
          visible: dist <= 2,
          roomId: dist <= 2 ? behindRoomRef.current : null,
          fakeRoomIds: [],
        });
        setStatusText(
          dist <= 2
            ? `신호 정상화. 위치 수신: ${roomMap[behindRoomRef.current].label}`
            : "신호 정상화. 근접 반응 없음."
        );
      } else {
        const dist = getDistance(playerRoomRef.current, behindRoomRef.current);
        setDetection({
          visible: dist <= 2,
          roomId: dist <= 2 ? behindRoomRef.current : null,
          fakeRoomIds: [],
        });
        setStatusText(
          dist <= 2
            ? `탐지 결과 수신: ${roomMap[behindRoomRef.current].label}`
            : "탐지 결과: 2칸 이내 반응 없음."
        );
      }

      setIsScanning(false);
      setScanReady(true);
      stopScanAudio();
      playCheck2Audio();

      if (playerRoomRef.current === behindRoomRef.current) {
        setDetection({
          visible: true,
          roomId: playerRoomRef.current,
          fakeRoomIds: [],
        });
        setStatusText("탐지 완료. 같은 방 안의 응답이 하나로 겹친다.");
        startDeathSequence("탐지가 끝난 직후, 같은 방 안에 있던 것이 천천히 시야를 덮었다.", {
          withBlackoutReveal: true,
          preRevealMs: 650,
        });
      }
    }, SCAN_TIME);
  }

  function handleEscape() {
    if (phase !== "playing") return;
    if (!finished) return;
    if (playerRoom !== "R7") return;
    if (isMoving || isScanning || deathPending) return;

    if (sameRoomCause === "enemyEnteredPlayerRoom") {
      startDeathSequence("같은 방 안에서 탈출 장치를 건드린 순간, 차가운 금속음 뒤로 모든 것이 끊겼다.");
      return;
    }

    setEscapeActive(true);
    setEscapeStartedAt(Date.now());
    setEscapeWhiteFade(true);
    setStatusText("중앙 탈출 장치를 작동 중이다.");
    playEscapeAudio();

    escapeTimerRef.current = window.setTimeout(() => {
      stopEscapeAudio();

      if (bgmRef.current) {
        bgmRef.current.pause();
        bgmRef.current.currentTime = 0;
      }

      stopChargeAudio(true);
      setPhase("escaped");
      setEscapeActive(false);
      setStatusText("복귀 신호 송신 완료.");
    }, ESCAPE_TIME);
  }

  useEffect(() => {
    if (!escapeActive) return;
    if (playerRoom !== "R7" || isMoving) {
      if (escapeTimerRef.current) clearTimeout(escapeTimerRef.current);
      stopEscapeAudio();

      setEscapeActive(false);
      setEscapeStartedAt(null);
      setEscapeWhiteFade(false);
      setStatusText("탈출 시퀀스가 끊겼다.");
    }
  }, [playerRoom, isMoving, escapeActive]);

  function handleRestart() {
    cleanupTimers();

    const nextPlayer = randomOf(startRooms);
    const nextBehind = getSafeInitialBehind(nextPlayer);

    setPhase("playing");
    setViewMode("map");
    setPlayerRoom(nextPlayer);
    setBehindRoom(nextBehind);
    setIsMoving(false);
    setMoveTarget(null);
    setProgress({ A: 0, B: 0, C: 0 });
    setStatusText("새 침입 경로가 설정되었다.");
    setDangerText("탐지 없이는 위치를 특정할 수 없다.");
    setIsScanning(false);
    setScanReady(true);
    setDetection({
      visible: false,
      roomId: null,
      fakeRoomIds: [],
    });

    setSameRoomCause(null);
    sameRoomCauseRef.current = null;

    setEnemyMode("wander");
    setEnemyAlertUntil(null);

    setEscapeActive(false);
    setEscapeStartedAt(null);
    setMeltdownTriggered(false);
    setMeltdownResolved(false);
    setMeltdownVisual(false);
    setDeathFade(false);
    setScreenStatic(false);
    setEscapeBlueFade(false);
    setEscapeWhiteFade(false);
    setEscapeTypedLines(["", "", ""]);

    setDeathDistort(false);
    setRoomRevealBlackout(false);
    setDeathPending(false);
    deathPendingRef.current = false;

    chargeTimeByRoomRef.current = {};
    chargeRoomRef.current = null;
    prevProgressRef.current = { A: 0, B: 0, C: 0 };

    if (bgmRef.current) {
      bgmRef.current.currentTime = 0;
      bgmRef.current.play().catch(() => {});
    }

    playerRoomRef.current = nextPlayer;
    behindRoomRef.current = nextBehind;
  }

  return (
    <div
      style={{
        ...styles.app,
        animation:
          escapeActive && phase === "playing" ? "escapeShake 0.16s linear infinite" : "none",
      }}
    >
      <style>{`
        @keyframes blinkSlow {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.25; transform: scale(0.92); }
        }

        @keyframes blinkFast {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.08; transform: scale(0.82); }
        }

        @keyframes spinLoader {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }

        @keyframes staticFlicker {
          0% { opacity: 0.18; transform: translateX(0); }
          25% { opacity: 0.28; transform: translateX(-1px); }
          50% { opacity: 0.12; transform: translateX(1px); }
          75% { opacity: 0.26; transform: translateX(-0.5px); }
          100% { opacity: 0.18; transform: translateX(0); }
        }

        @keyframes blueFadePulse {
          0%, 100% { opacity: 0.24; }
          50% { opacity: 0.34; }
        }

        @keyframes caretBlink {
          0%, 49% { opacity: 1; }
          50%, 100% { opacity: 0; }
        }

        @keyframes deathRedFade {
          0% { background: rgba(255, 0, 0, 0); }
          20% { background: rgba(255, 0, 0, 0.85); }
          60% { background: rgba(120, 0, 0, 0.92); }
          100% { background: rgba(0, 0, 0, 1); }
        }

        @keyframes moveBoardBlink {
          0%, 100% {
            opacity: 1;
            filter: brightness(1);
            box-shadow:
              inset 0 0 40px rgba(0,0,0,0.9),
              0 0 0 rgba(120,180,255,0);
          }
          50% {
            opacity: 0.72;
            filter: brightness(1.08);
            box-shadow:
              inset 0 0 40px rgba(0,0,0,0.9),
              0 0 14px rgba(120,180,255,0.18);
          }
        }

        @keyframes escapeWhiteFade {
          0% { opacity: 0; }
          100% { opacity: 1; }
        }

        @keyframes escapeShake {
          0% { transform: translate(0px, 0px); }
          10% { transform: translate(-2px, 1px); }
          20% { transform: translate(2px, -1px); }
          30% { transform: translate(-3px, 2px); }
          40% { transform: translate(3px, -2px); }
          50% { transform: translate(-2px, -1px); }
          60% { transform: translate(2px, 2px); }
          70% { transform: translate(-1px, -2px); }
          80% { transform: translate(2px, 1px); }
          90% { transform: translate(-2px, -1px); }
          100% { transform: translate(0px, 0px); }
        }

        @keyframes deathWarp {
          0% {
            transform: scale(1) skew(0deg, 0deg) rotate(0deg);
            filter: blur(0px) contrast(1) saturate(1);
          }
          20% {
            transform: scale(1.018) skew(-1.2deg, 0.6deg) rotate(-0.18deg);
            filter: blur(0.8px) contrast(1.15) saturate(1.1);
          }
          40% {
            transform: scale(0.99) skew(1.8deg, -1deg) rotate(0.22deg);
            filter: blur(1.3px) contrast(1.28) saturate(1.18);
          }
          60% {
            transform: scale(1.025) skew(-2.2deg, 1.1deg) rotate(-0.32deg);
            filter: blur(1.8px) contrast(1.4) saturate(1.22);
          }
          80% {
            transform: scale(0.985) skew(2.4deg, -1.5deg) rotate(0.28deg);
            filter: blur(2.2px) contrast(1.52) saturate(1.28);
          }
          100% {
            transform: scale(1.03) skew(-2.6deg, 1.8deg) rotate(-0.35deg);
            filter: blur(2.8px) contrast(1.62) saturate(1.35);
          }
        }

        @keyframes trappedPulse {
          0%, 100% { opacity: 0.18; }
          50% { opacity: 0.32; }
        }
      `}</style>

      <div
        style={{
          ...styles.bootOverlay,
          opacity: fadeIn ? 1 : 0,
          pointerEvents: fadeIn ? "auto" : "none",
        }}
      />

      <div style={styles.headerRow}>
        <div>
          <div style={styles.title}>Regular Engagement</div>
          <div style={styles.subTitle}>데이터 침투 프로토콜 v2</div>
        </div>

        <div style={styles.headerButtons}>
          <button
            style={viewMode === "map" ? styles.modeButtonActive : styles.modeButton}
            onClick={() => requestViewMode("map")}
          >
            맵
          </button>
          <button
            style={viewMode === "tablet" ? styles.modeButtonActive : styles.modeButton}
            onClick={() => requestViewMode("tablet")}
          >
            태블릿
          </button>
        </div>
      </div>

      <div style={styles.topInfoBar}>
        <div style={styles.infoBlock}>
          <div style={styles.infoLabel}>현재 목표</div>
          <div style={styles.infoValue}>
            {finished ? "중앙으로 이동해 탈출" : "A / B / C 데이터 확보"}
          </div>
        </div>

        <div style={styles.infoBlock}>
          <div style={styles.infoLabel}>진행률</div>
          <div style={styles.infoValue}>{overallProgress}%</div>
        </div>

        <div style={styles.infoBlock}>
          <div style={styles.infoLabel}>탐지</div>
          <div style={styles.infoValue}>
            {isScanning ? "스캔 중" : scanReady ? "사용 가능" : "불가"}
          </div>
        </div>

        <div style={styles.infoBlock}>
          <div style={styles.infoLabel}>적 상태</div>
          <div style={styles.infoValue}>
            {sameRoomCause === "enemyEnteredPlayerRoom"
              ? "같은 방"
              : enemyMode === "wander"
              ? "배회"
              : enemyMode === "alerted"
              ? "발견"
              : "공격 대기"}
          </div>
        </div>
      </div>

      <div
        style={{
          ...styles.mainWrap,
          animation: deathDistort ? "deathWarp 0.55s ease-in-out infinite alternate" : "none",
          transformOrigin: "center center",
        }}
      >
        <div style={styles.leftPanel}>
          <div style={styles.topStatusBar}>
            <div style={isMoving ? styles.spinnerFast : styles.spinner} />
            <span style={styles.topStatusText}>
              {deathPending
                ? "붕괴 중..."
                : isMoving
                ? "벤트 이동 중..."
                : isScanning
                ? "탐지 중..."
                : "대기 중"}
            </span>
          </div>

          {viewMode === "map" ? (
            <div style={styles.mapBoardWrap}>
              <div
                style={{
                  ...styles.mapBoard,
                  animation: isMoving ? "moveBoardBlink 0.55s ease-in-out infinite" : "none",
                }}
              >
                {corridorSegments.map((seg, i) => {
                  const a = rooms.find((r) => r.id === seg.left)!;
                  const b = rooms.find((r) => r.id === seg.right)!;

                  const ax = a.x * GAP_X + OFFSET_X + ROOM_WIDTH / 2;
                  const ay = a.y * GAP_Y + OFFSET_Y + ROOM_HEIGHT / 2;
                  const bx = b.x * GAP_X + OFFSET_X + ROOM_WIDTH / 2;
                  const by = b.y * GAP_Y + OFFSET_Y + ROOM_HEIGHT / 2;

                  const isHorizontal = ay === by;

                  return (
                    <div
                      key={i}
                      style={{
                        position: "absolute",
                        left: Math.min(ax, bx),
                        top: Math.min(ay, by),
                        width: isHorizontal ? Math.abs(bx - ax) : 4,
                        height: isHorizontal ? 4 : Math.abs(by - ay),
                        background: "rgba(111,122,131,0.92)",
                        borderRadius: 0,
                      }}
                    />
                  );
                })}

                {rooms.map((room) => {
                  const left = room.x * GAP_X + OFFSET_X;
                  const top = room.y * GAP_Y + OFFSET_Y;
                  const isCurrent = playerRoom === room.id;
                  const isNeighbor = roomMap[playerRoom].neighbors.includes(room.id);
                  const isDetected = detection.visible && detection.roomId === room.id;
                  const isFakeDetected = detection.fakeRoomIds.includes(room.id);
                  const isSameRoomRevealed =
                    roomRevealBlackout &&
                    (room.id === playerRoomRef.current || room.id === behindRoomRef.current);

                  return (
                    <div
                      key={room.id}
                      onClick={() => handleMove(room.id)}
                      style={{
                        ...styles.room,
                        left,
                        top,
                        cursor:
                          isMoving || isScanning || escapeActive || deathPending
                            ? "default"
                            : isNeighbor
                            ? "pointer"
                            : "default",
                        opacity: roomRevealBlackout
                          ? isSameRoomRevealed
                            ? 1
                            : 0.05
                          : isCurrent
                          ? 1
                          : isNeighbor
                          ? 1
                          : 0.8,
                        borderColor:
                          room.id === moveTarget
                            ? "#c8d7e8"
                            : isNeighbor
                            ? "#91a8bc"
                            : "#6a7580",
                        transition: "opacity 0.18s ease, border-color 0.18s ease",
                      }}
                    >
                      <div style={styles.roomId}>{room.id}</div>
                      <div style={styles.roomLabel}>{room.label}</div>

                      {room.type === "dataA" && <div style={styles.roomTag}>A</div>}
                      {room.type === "dataB" && <div style={styles.roomTag}>B</div>}
                      {room.type === "dataC" && <div style={styles.roomTag}>C</div>}
                      {room.type === "center" && <div style={styles.roomTag}>중앙</div>}

                      {isCurrent && (
                        <div style={isMoving ? styles.playerDotFast : styles.playerDot} />
                      )}

                      {isDetected && <div style={styles.enemyDot} />}
                      {isFakeDetected && <div style={styles.fakeEnemyDot} />}
                    </div>
                  );
                })}
              </div>

              <div style={styles.actionRow}>
                <button
                  style={
                    scanReady && !isScanning && !isMoving && !deathPending
                      ? styles.actionButton
                      : styles.actionButtonDisabled
                  }
                  onClick={handleScan}
                  disabled={!scanReady || isScanning || isMoving || deathPending}
                >
                  {isScanning
                    ? "스캔 중..."
                    : meltdownTriggered && !meltdownResolved
                    ? "재탐지"
                    : "탐지"}
                </button>

                <button
                  style={
                    playerRoom === "R7" && finished && !escapeActive && !deathPending
                      ? styles.actionButton
                      : styles.actionButtonDisabled
                  }
                  onClick={handleEscape}
                  disabled={!(playerRoom === "R7" && finished && !escapeActive && !deathPending)}
                >
                  {escapeActive ? `탈출 ${escapeSeconds}s` : "중앙 탈출"}
                </button>
              </div>
            </div>
          ) : (
            <div style={styles.tabletWrap}>
              <div style={styles.tabletScreen}>
                <div style={styles.tabletTitle}>정보국 데이터 체계로 업로드</div>
                <div style={styles.tabletCurrent}>현재 위치: {currentRoom.label}</div>

                <div style={styles.progressGrid}>
                  <div style={styles.progressCard}>
                    <div style={styles.progressCardTitle}>A 데이터</div>
                    <div style={styles.progressBar}>
                      <div style={{ ...styles.progressFill, width: `${progress.A}%` }} />
                    </div>
                    <div style={styles.progressText}>{Math.floor(progress.A)}%</div>
                  </div>

                  <div style={styles.progressCard}>
                    <div style={styles.progressCardTitle}>B 데이터</div>
                    <div style={styles.progressBar}>
                      <div style={{ ...styles.progressFill, width: `${progress.B}%` }} />
                    </div>
                    <div style={styles.progressText}>{Math.floor(progress.B)}%</div>
                  </div>

                  <div style={styles.progressCard}>
                    <div style={styles.progressCardTitle}>C 데이터</div>
                    <div style={styles.progressBar}>
                      <div style={{ ...styles.progressFill, width: `${progress.C}%` }} />
                    </div>
                    <div style={styles.progressText}>{Math.floor(progress.C)}%</div>
                  </div>
                </div>

                <div style={styles.tabletHint}>
                  {getTaskKeyByRoom(playerRoom)
                    ? "현재 구역에서는 태블릿을 켜 두는 동안 데이터가 누적된다."
                    : "현재 구역은 데이터 수집 지점이 아니다."}
                </div>
                <img src="/images/logo.png" style={styles.tabletLogo} />
              </div>
            </div>
          )}
        </div>

        <div style={styles.rightPanel}>
          <div style={styles.sideCard}>
            <div style={styles.sideTitle}>현재 상태</div>
            <div style={styles.sideLine}>구역: {currentRoom.label}</div>
            <div style={styles.sideLine}>
              위험 요소:{" "}
              {sameRoomCause === "enemyEnteredPlayerRoom"
                ? "같은 방"
                : enemyMode === "attackWindup"
                ? "바로 앞"
                : enemyMode === "alerted"
                ? "추적 중"
                : "배회 중"}
            </div>
            <div style={styles.sideLine}>이동 상태: {isMoving ? "벤트 이동 중" : "정지"}</div>
          </div>

          <div style={styles.sideCard}>
            <div style={styles.sideTitle}>위험 문구</div>
            <div style={styles.sideText}>{dangerText}</div>
          </div>

          <div style={styles.sideCard}>
            <div style={styles.sideTitle}>진행 목표</div>
            <div style={styles.sideText}>
              {finished
                ? "모든 데이터 확보 완료. 중앙에서 4초 버티면 탈출."
                : "A / B / C 지점에서 데이터를 확보한 뒤 중앙으로 복귀하라."}
            </div>
          </div>
        </div>
      </div>

      <div style={styles.bottomBar}>{statusText}</div>

      {phase === "dying" && (
        <div style={styles.overlay}>
          <div style={styles.overlayTitle}>연결 종료됨.</div>
          <div style={styles.overlayText}>
            알 수 없는 이유로 파견된 요원의 생체 신호가 종료되었습니다.
          </div>
          <button style={styles.overlayButton} onClick={handleRestart}>
            다시 시도
          </button>
        </div>
      )}

      {phase === "escaped" && (
        <div style={styles.escapeOverlay}>
          <div style={styles.escapeTerminal}>
            {escapeTypedLines.map((line, idx) => (
              <div key={idx} style={styles.escapeLine}>
                {line}
                {idx ===
                  escapeTypedLines.findIndex((x, i, arr) =>
                    i === arr.length - 1 ? x !== ESCAPE_LINES[i] : arr[i + 1] === ""
                  ) && line.length < ESCAPE_LINES[idx].length ? (
                  <span style={styles.caret}>█</span>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      )}

      <div
        style={{
          ...styles.meltdownOverlay,
          opacity: meltdownVisual ? 0.24 : 0,
        }}
      />

      <div
        style={{
          ...styles.staticOverlay,
          opacity: screenStatic ? 0.18 : phase === "dying" ? 0.32 : 0,
        }}
      />

      <div
        style={{
          ...styles.roomRevealOverlay,
          opacity: roomRevealBlackout ? 1 : 0,
        }}
      />

      <div
        style={{
          ...styles.sameRoomOverlay,
          opacity: sameRoomCause === "enemyEnteredPlayerRoom" && !deathPending ? 1 : 0,
        }}
      />

      <div
        style={{
          ...styles.escapeBlueOverlay,
          opacity: escapeBlueFade ? 0.78 : 0,
        }}
      />

      <div
        style={{
          ...styles.escapeWhiteOverlay,
          opacity: escapeWhiteFade || phase === "escaped" ? 1 : 0,
          animation: escapeActive ? "escapeWhiteFade 4s linear forwards" : "none",
        }}
      />

      <div
        style={{
          ...styles.deathOverlay,
          opacity: deathFade ? 1 : 0,
        }}
      />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  app: {
    minHeight: "100vh",
    background: "#0b0f14",
    color: "white",
    fontFamily: "sans-serif",
    padding: "24px",
    boxSizing: "border-box",
    position: "relative",
    overflow: "hidden",
  },

  bootOverlay: {
    position: "absolute",
    inset: 0,
    background: "#000",
    zIndex: 30,
    transition: "opacity 1.6s ease",
  },

  headerRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
    gap: 16,
    position: "relative",
    zIndex: 2,
  },

  title: {
    fontSize: "30px",
    fontWeight: 800,
    marginBottom: 4,
  },

  subTitle: {
    fontSize: "13px",
    color: "#97a6b4",
  },

  headerButtons: {
    display: "flex",
    gap: 8,
  },

  modeButton: {
    background: "#12181f",
    color: "#d6e1eb",
    border: "1px solid #5d6a75",
    padding: "10px 16px",
    cursor: "pointer",
  },

  modeButtonActive: {
    background: "#1a2530",
    color: "#eef5ff",
    border: "1px solid #91a8bc",
    padding: "10px 16px",
    cursor: "pointer",
  },

  topInfoBar: {
    display: "grid",
    gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
    gap: 10,
    marginBottom: 14,
    position: "relative",
    zIndex: 2,
  },

  infoBlock: {
    background: "#12181f",
    border: "1px solid #56626c",
    padding: "10px 12px",
  },

  infoLabel: {
    fontSize: "11px",
    color: "#8fa0af",
    marginBottom: 4,
  },

  infoValue: {
    fontSize: "14px",
    fontWeight: 700,
  },

  mainWrap: {
    display: "grid",
    gridTemplateColumns: "1.4fr 0.8fr",
    gap: 16,
    position: "relative",
    zIndex: 2,
    transition: "transform 0.12s ease, filter 0.12s ease",
  },

  leftPanel: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },

  rightPanel: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },

  sideCard: {
    background: "#11171d",
    border: "1px solid #58636d",
    padding: "14px",
  },

  sideTitle: {
    fontSize: "14px",
    fontWeight: 800,
    marginBottom: 10,
  },

  sideLine: {
    fontSize: "13px",
    color: "#d6e0ea",
    marginBottom: 8,
  },

  sideText: {
    fontSize: "13px",
    color: "#b9c6d1",
    lineHeight: 1.5,
  },

  topStatusBar: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    color: "#b8c7d6",
    fontSize: "14px",
  },

  topStatusText: {
    fontSize: "14px",
    fontWeight: 600,
  },

  spinner: {
    width: 16,
    height: 16,
    border: "2px solid rgba(180,200,220,0.25)",
    borderTop: "2px solid #8fb6ff",
    borderRadius: "50%",
    animation: "spinLoader 1.2s linear infinite",
  },

  spinnerFast: {
    width: 16,
    height: 16,
    border: "2px solid rgba(180,200,220,0.25)",
    borderTop: "2px solid #8fb6ff",
    borderRadius: "50%",
    animation: "spinLoader 0.55s linear infinite",
  },

  mapBoardWrap: {
    background: "#0f1419",
    border: "1px solid #57616b",
    padding: "14px",
  },

  mapBoard: {
    position: "relative",
    width: BOARD_WIDTH,
    height: BOARD_HEIGHT,
    border: "2px solid #5f6b75",
    background: "#0a0d10",
    overflow: "hidden",
    boxShadow: "inset 0 0 40px rgba(0,0,0,0.9)",
  },

  room: {
    position: "absolute",
    width: ROOM_WIDTH,
    height: ROOM_HEIGHT,
    background: "#0f1419",
    border: "2px solid #7f8c98",
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    alignItems: "center",
    boxSizing: "border-box",
    boxShadow: "inset 0 0 6px rgba(0,0,0,0.8)",
    userSelect: "none",
  },

  roomId: {
    fontSize: "12px",
    opacity: 0.7,
  },

  roomLabel: {
    fontSize: "13px",
    fontWeight: 700,
    marginTop: 4,
  },

  roomTag: {
    position: "absolute",
    top: 4,
    left: 6,
    fontSize: "10px",
    color: "#a4b4c2",
  },

  playerDot: {
    position: "absolute",
    width: 10,
    height: 10,
    borderRadius: "50%",
    background: "#4da3ff",
    bottom: 6,
    right: 6,
    boxShadow: "0 0 10px rgba(77,163,255,0.8)",
    animation: "blinkSlow 1.3s infinite",
  },

  playerDotFast: {
    position: "absolute",
    width: 10,
    height: 10,
    borderRadius: "50%",
    background: "#4da3ff",
    bottom: 6,
    right: 6,
    boxShadow: "0 0 14px rgba(77,163,255,0.95)",
    animation: "blinkFast 0.35s infinite",
  },

  enemyDot: {
    position: "absolute",
    width: 10,
    height: 10,
    borderRadius: "50%",
    background: "#ff4f4f",
    bottom: 6,
    left: 6,
    boxShadow: "0 0 12px rgba(255,79,79,0.9)",
  },

  fakeEnemyDot: {
    position: "absolute",
    width: 10,
    height: 10,
    borderRadius: "50%",
    background: "rgba(255,79,79,0.5)",
    bottom: 6,
    left: 6,
    boxShadow: "0 0 12px rgba(255,79,79,0.45)",
  },

  actionRow: {
    display: "flex",
    gap: 10,
    marginTop: 12,
  },

  actionButton: {
    background: "#18212a",
    color: "#edf5ff",
    border: "1px solid #8ea4b7",
    padding: "10px 16px",
    cursor: "pointer",
  },

  actionButtonDisabled: {
    background: "#11161b",
    color: "#7c8791",
    border: "1px solid #48525c",
    padding: "10px 16px",
    cursor: "default",
  },

  tabletWrap: {
    background: "#0f1419",
    border: "1px solid #57616b",
    padding: "14px",
    minHeight: 420,
  },

  tabletScreen: {
    minHeight: 390,
    border: "1px solid #5b6670",
    background: "linear-gradient(180deg, #141b22 0%, #0d1217 100%)",
    padding: "18px",
    position: "relative",
  },

  tabletTitle: {
    fontSize: "20px",
    fontWeight: 800,
    marginBottom: 8,
  },

  tabletCurrent: {
    fontSize: "13px",
    color: "#9fb0bf",
    marginBottom: 18,
  },

  progressGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: 12,
  },

  progressCard: {
    background: "#11171d",
    border: "1px solid #5e6974",
    padding: "12px",
    position: "relative",
  },

  progressCardTitle: {
    fontSize: "14px",
    fontWeight: 700,
    marginBottom: 10,
  },

  progressBar: {
    width: "100%",
    height: 10,
    background: "#232f3a",
    overflow: "hidden",
    marginBottom: 8,
  },

  progressFill: {
    height: "100%",
    background: "#8fb6ff",
  },

  progressText: {
    fontSize: "12px",
    color: "#d2dce5",
  },

  tabletHint: {
    marginTop: 20,
    fontSize: "13px",
    color: "#a8b6c2",
    lineHeight: 1.5,
  },

  bottomBar: {
    marginTop: 16,
    background: "#12181f",
    border: "1px solid #56626c",
    padding: "12px 14px",
    position: "relative",
    zIndex: 2,
  },

  overlay: {
    position: "absolute",
    inset: 0,
    background: "rgba(0,0,0,0.78)",
    zIndex: 24,
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    alignItems: "center",
    gap: 12,
  },

  overlayTitle: {
    fontSize: "34px",
    fontWeight: 900,
    letterSpacing: 1,
  },

  overlayText: {
    fontSize: "14px",
    color: "#c2cfdb",
  },

  overlayButton: {
    background: "#18212a",
    color: "#edf5ff",
    border: "1px solid #8ea4b7",
    padding: "12px 18px",
    cursor: "pointer",
  },

  meltdownOverlay: {
    position: "absolute",
    inset: 0,
    background: "rgba(255, 65, 65, 0.45)",
    pointerEvents: "none",
    transition: "opacity 0.2s ease",
    zIndex: 10,
  },

  staticOverlay: {
    position: "absolute",
    inset: 0,
    pointerEvents: "none",
    zIndex: 16,
    background:
      "repeating-linear-gradient(0deg, rgba(255,255,255,0.12) 0px, rgba(255,255,255,0.12) 1px, transparent 1px, transparent 3px)",
    mixBlendMode: "screen",
    animation: "staticFlicker 0.12s steps(2, end) infinite",
    transition: "opacity 0.18s ease",
  },

  roomRevealOverlay: {
    position: "absolute",
    inset: 0,
    pointerEvents: "none",
    zIndex: 17,
    background: "rgba(0,0,0,0.9)",
    transition: "opacity 0.14s ease",
  },

  sameRoomOverlay: {
    position: "absolute",
    inset: 0,
    pointerEvents: "none",
    zIndex: 17,
    background: "rgba(120, 0, 0, 0.22)",
    animation: "trappedPulse 1.2s ease-in-out infinite",
    transition: "opacity 0.18s ease",
  },

  escapeBlueOverlay: {
    position: "absolute",
    inset: 0,
    pointerEvents: "none",
    zIndex: 18,
    background: "rgba(40, 90, 255, 0.72)",
    animation: "blueFadePulse 1.6s ease-in-out infinite",
    transition: "opacity 1.1s ease",
  },

  escapeWhiteOverlay: {
    position: "absolute",
    inset: 0,
    pointerEvents: "none",
    zIndex: 19,
    background: "#ffffff",
    transition: "opacity 0.25s ease",
  },

  deathOverlay: {
    position: "absolute",
    inset: 0,
    pointerEvents: "none",
    zIndex: 22,
    animation: "deathRedFade 1.6s ease forwards",
    transition: "opacity 0.2s ease",
  },

  escapeOverlay: {
    position: "absolute",
    inset: 0,
    background: "rgba(245, 248, 255, 0.82)",
    zIndex: 21,
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    alignItems: "center",
    gap: 22,
  },

  escapeTerminal: {
    minWidth: 320,
    maxWidth: "80vw",
    padding: "24px 28px",
    background: "rgba(0, 8, 20, 0.72)",
    border: "1px solid rgba(135,170,255,0.55)",
    boxShadow: "0 0 30px rgba(90,130,255,0.18)",
    fontFamily: "monospace",
    color: "#d8e7ff",
    fontSize: "22px",
    lineHeight: 1.8,
    textAlign: "left",
  },

  escapeLine: {
    minHeight: "1.8em",
    whiteSpace: "pre-wrap",
  },

  caret: {
    display: "inline-block",
    marginLeft: 2,
    animation: "caretBlink 1s step-end infinite",
  },

  tabletLogo: {
    display: "block",
    margin: "12px auto 0",
    width: 80,
    height: 80,
    opacity: 0.2,
  },
};