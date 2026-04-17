import { useState, useRef, useCallback } from "react";

const WAV_RECORDER_WORKLET = "wav-recorder-processor";

function createWavBlob(buffers, sampleRate) {
  const totalSamples = buffers.reduce((sum, buffer) => sum + buffer.length, 0);
  if (totalSamples === 0) {
    return null;
  }

  const bytesPerSample = 2;
  const blockAlign = bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = totalSamples * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset, value) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  buffers.forEach((chunk) => {
    for (let index = 0; index < chunk.length; index += 1) {
      const sample = Math.max(-1, Math.min(1, chunk[index]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += bytesPerSample;
    }
  });

  return new Blob([buffer], { type: "audio/wav" });
}

function resolvePublicBaseUrl() {
  const viteBaseUrl = import.meta.env?.BASE_URL;
  if (typeof viteBaseUrl === "string" && viteBaseUrl) {
    return viteBaseUrl;
  }

  if (typeof process !== "undefined" && process?.env?.PUBLIC_URL) {
    return process.env.PUBLIC_URL;
  }

  return "";
}

export function resolveWavRecorderWorkletUrl(publicUrl = resolvePublicBaseUrl()) {
  const normalizedBase = publicUrl.endsWith("/") ? publicUrl.slice(0, -1) : publicUrl;
  return `${normalizedBase}/wav-recorder-processor.js`;
}

function isRecoverableAudioContextStateError(error) {
  const invalidStateCode = globalThis.DOMException?.INVALID_STATE_ERR;
  return error?.name === "InvalidStateError" || (invalidStateCode && error?.code === invalidStateCode);
}

export async function runAudioContextTransition(context, targetState) {
  if (!context) {
    return true;
  }

  const transitionMap = {
    running: "resume",
    suspended: "suspend",
    closed: "close",
  };
  const transitionMethod = transitionMap[targetState];

  if (!transitionMethod || typeof context[transitionMethod] !== "function") {
    return true;
  }

  if (targetState === "closed") {
    if (context.state === "closed") {
      return true;
    }
  } else if (context.state === targetState) {
    return true;
  } else if (
    (targetState === "suspended" && context.state !== "running") ||
    (targetState === "running" && context.state !== "suspended")
  ) {
    return false;
  }

  try {
    await context[transitionMethod]();
    return true;
  } catch (error) {
    if (isRecoverableAudioContextStateError(error)) {
      console.warn(`Recorder ${transitionMethod} interrupted by a competing state change.`, error);
      return false;
    }

    throw error;
  }
}

export function useAudioRecorder({ onChunkReady, chunkIntervalMs = 6000 }) {
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const streamRef = useRef(null);
  const audioContextRef = useRef(null);
  const sourceNodeRef = useRef(null);
  const workletNodeRef = useRef(null);
  const muteNodeRef = useRef(null);
  const timerRef = useRef(null);
  const chunkTimerRef = useRef(null);
  const elapsedRef = useRef(0);
  const isPausedRef = useRef(false);
  const chunkIndexRef = useRef(0);
  const lastChunkElapsedRef = useRef(0);
  const chunkBuffersRef = useRef([]);
  const chunkSampleCountRef = useRef(0);
  const sampleRateRef = useRef(16000);

  const startTimer = useCallback(() => {
    timerRef.current = setInterval(() => {
      elapsedRef.current += 1;
      setElapsedSeconds(elapsedRef.current);
    }, 1000);
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const stopChunkTimer = useCallback(() => {
    if (chunkTimerRef.current) {
      clearInterval(chunkTimerRef.current);
      chunkTimerRef.current = null;
    }
  }, []);

  const emitChunk = useCallback(
    (blob, elapsedSnapshot, durationSeconds) => {
      if (!blob || blob.size <= 1000) {
        return;
      }

      onChunkReady(blob, chunkIndexRef.current, elapsedSnapshot, durationSeconds);
      chunkIndexRef.current += 1;
    },
    [onChunkReady]
  );

  const resetChunkBuffer = useCallback(() => {
    chunkBuffersRef.current = [];
    chunkSampleCountRef.current = 0;
  }, []);

  const resetRecorderState = useCallback(() => {
    setIsRecording(false);
    setIsPaused(false);
    isPausedRef.current = false;
    elapsedRef.current = 0;
    setElapsedSeconds(0);
    chunkIndexRef.current = 0;
    lastChunkElapsedRef.current = 0;
    resetChunkBuffer();
  }, [resetChunkBuffer]);

  const cleanupAudioGraph = useCallback(async () => {
    stopChunkTimer();

    if (workletNodeRef.current) {
      workletNodeRef.current.port.onmessage = null;
      workletNodeRef.current.disconnect();
      workletNodeRef.current = null;
    }

    if (sourceNodeRef.current) {
      sourceNodeRef.current.disconnect();
      sourceNodeRef.current = null;
    }

    if (muteNodeRef.current) {
      muteNodeRef.current.disconnect();
      muteNodeRef.current = null;
    }

    if (audioContextRef.current) {
      const context = audioContextRef.current;
      audioContextRef.current = null;
      await runAudioContextTransition(context, "closed");
    }
  }, [stopChunkTimer]);

  const cleanupStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  }, []);

  const flushChunk = useCallback(() => {
    if (chunkSampleCountRef.current <= 0) {
      return;
    }

    const durationSeconds = Math.max(chunkSampleCountRef.current / sampleRateRef.current, 1);
    const blob = createWavBlob(chunkBuffersRef.current, sampleRateRef.current);
    resetChunkBuffer();

    if (!blob) {
      return;
    }

    lastChunkElapsedRef.current += durationSeconds;
    const elapsedSnapshot = Math.max(elapsedRef.current, Math.round(lastChunkElapsedRef.current));
    emitChunk(blob, elapsedSnapshot, durationSeconds);
  }, [emitChunk, resetChunkBuffer]);

  const startChunkTimer = useCallback(() => {
    stopChunkTimer();
    chunkTimerRef.current = setInterval(() => {
      if (!isPausedRef.current) {
        flushChunk();
      }
    }, chunkIntervalMs);
  }, [chunkIntervalMs, flushChunk, stopChunkTimer]);

  const getUserMediaWithFallback = useCallback(async () => {
    const supportedConstraints = {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      sampleRate: 16000,
      channelCount: 1,
    };

    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: supportedConstraints,
      });
    } catch (err) {
      if (err && ["OverconstrainedError", "NotSupportedError"].includes(err.name)) {
        return await navigator.mediaDevices.getUserMedia({ audio: true });
      }
      throw err;
    }
  }, []);

  const startRecording = useCallback(async () => {
    try {
      stopTimer();
      await cleanupAudioGraph();
      cleanupStream();

      const stream = await getUserMediaWithFallback();
      const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextCtor) {
        throw new Error("Web Audio API is not supported in this browser.");
      }

      const audioContext = new AudioContextCtor();
      const AudioWorkletNodeCtor = window.AudioWorkletNode || globalThis.AudioWorkletNode;
      if (!audioContext.audioWorklet || !AudioWorkletNodeCtor) {
        throw new Error("Audio worklets are not supported in this browser.");
      }

      await audioContext.audioWorklet.addModule(resolveWavRecorderWorkletUrl());

      const sourceNode = audioContext.createMediaStreamSource(stream);
      const workletNode = new AudioWorkletNodeCtor(audioContext, WAV_RECORDER_WORKLET, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      });
      const muteNode = audioContext.createGain();
      muteNode.gain.value = 0;

      workletNode.port.onmessage = (event) => {
        if (isPausedRef.current) {
          return;
        }

        const sampleBuffer = event.data?.samples;
        if (!(sampleBuffer instanceof ArrayBuffer)) {
          return;
        }

        const copiedChunk = new Float32Array(sampleBuffer);
        chunkBuffersRef.current.push(copiedChunk);
        chunkSampleCountRef.current += copiedChunk.length;
      };

      sourceNode.connect(workletNode);
      workletNode.connect(muteNode);
      muteNode.connect(audioContext.destination);

      streamRef.current = stream;
      audioContextRef.current = audioContext;
      sourceNodeRef.current = sourceNode;
      workletNodeRef.current = workletNode;
      muteNodeRef.current = muteNode;
      sampleRateRef.current = audioContext.sampleRate;

      elapsedRef.current = 0;
      chunkIndexRef.current = 0;
      lastChunkElapsedRef.current = 0;
      resetChunkBuffer();
      isPausedRef.current = false;

      setIsRecording(true);
      setIsPaused(false);
      setElapsedSeconds(0);
      startTimer();
      startChunkTimer();
    } catch (err) {
      console.error("Mic access denied:", err);
      throw err;
    }
  }, [cleanupAudioGraph, cleanupStream, getUserMediaWithFallback, resetChunkBuffer, startChunkTimer, startTimer, stopTimer]);

  const pauseRecording = useCallback(async () => {
    if (!isRecording || isPausedRef.current) {
      return true;
    }

    const didSuspend = await runAudioContextTransition(audioContextRef.current, "suspended");
    if (!didSuspend) {
      return false;
    }

    isPausedRef.current = true;
    setIsPaused(true);
    stopTimer();
    stopChunkTimer();
    flushChunk();
    return true;
  }, [flushChunk, isRecording, stopChunkTimer, stopTimer]);

  const resumeRecording = useCallback(async () => {
    if (!isRecording || !isPausedRef.current) {
      return true;
    }

    const didResume = await runAudioContextTransition(audioContextRef.current, "running");
    if (!didResume) {
      return false;
    }

    isPausedRef.current = false;
    setIsPaused(false);
    startTimer();
    startChunkTimer();
    return true;
  }, [isRecording, startChunkTimer, startTimer]);

  const stopRecording = useCallback(async () => {
    stopTimer();
    stopChunkTimer();
    flushChunk();

    try {
      await cleanupAudioGraph();
      return true;
    } finally {
      cleanupStream();
      resetRecorderState();
    }
  }, [cleanupAudioGraph, cleanupStream, flushChunk, resetRecorderState, stopChunkTimer, stopTimer]);

  return {
    isRecording,
    isPaused,
    elapsedSeconds,
    startRecording,
    pauseRecording,
    resumeRecording,
    stopRecording,
  };
}
