/**
 * Client-Side Audio Analysis & Silence Detection
 * Uses Web Audio API to detect real silence in video/audio files
 */

export interface SilenceSegment {
  start: number; // in seconds
  end: number;   // in seconds
  duration: number; // in seconds
}

export interface SpeechSegment {
  start: number;
  end: number;
  duration: number;
}

/**
 * Decode real audio from a video/audio file and detect silent dead-air regions
 */
export async function analyzeFileAudio(
  file: File,
  thresholdDb: number = -34,
  minSilenceDuration: number = 0.4
): Promise<{
  audioBuffer: AudioBuffer | null;
  silences: SilenceSegment[];
  speechSegments: SpeechSegment[];
  wavBase64: string | null;
}> {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    // Channel data (mono or left channel)
    const channelData = audioBuffer.getChannelData(0);
    const sampleRate = audioBuffer.sampleRate;
    const windowSize = Math.floor(sampleRate * 0.03); // 30ms window
    const totalWindows = Math.floor(channelData.length / windowSize);

    const thresholdLinear = Math.pow(10, thresholdDb / 20); // convert dB to linear amplitude
    const silences: SilenceSegment[] = [];

    let inSilence = false;
    let silenceStart = 0;

    for (let w = 0; w < totalWindows; w++) {
      let sumSquares = 0;
      const startSample = w * windowSize;
      const endSample = startSample + windowSize;

      for (let i = startSample; i < endSample; i++) {
        const val = channelData[i];
        sumSquares += val * val;
      }

      const rms = Math.sqrt(sumSquares / windowSize);
      const currentTime = startSample / sampleRate;

      if (rms < thresholdLinear) {
        if (!inSilence) {
          inSilence = true;
          silenceStart = currentTime;
        }
      } else {
        if (inSilence) {
          inSilence = false;
          const silenceDuration = currentTime - silenceStart;
          if (silenceDuration >= minSilenceDuration) {
            silences.push({
              start: Math.round(silenceStart * 100) / 100,
              end: Math.round(currentTime * 100) / 100,
              duration: Math.round(silenceDuration * 100) / 100
            });
          }
        }
      }
    }

    // Check tail
    if (inSilence) {
      const totalTime = channelData.length / sampleRate;
      const silenceDuration = totalTime - silenceStart;
      if (silenceDuration >= minSilenceDuration) {
        silences.push({
          start: Math.round(silenceStart * 100) / 100,
          end: Math.round(totalTime * 100) / 100,
          duration: Math.round(silenceDuration * 100) / 100
        });
      }
    }

    // Calculate non-silent speech segments (invert silences)
    const totalTime = channelData.length / sampleRate;
    const speechSegments: SpeechSegment[] = [];
    let lastSpeechPos = 0;

    silences.forEach(s => {
      if (s.start > lastSpeechPos + 0.1) {
        speechSegments.push({
          start: lastSpeechPos,
          end: s.start,
          duration: s.start - lastSpeechPos
        });
      }
      lastSpeechPos = s.end;
    });

    if (lastSpeechPos < totalTime - 0.1) {
      speechSegments.push({
        start: lastSpeechPos,
        end: totalTime,
        duration: totalTime - lastSpeechPos
      });
    }

    // Convert to downsampled 16kHz mono WAV for speech transcription
    const wavBase64 = encodeAudioBufferToWavBase64(audioBuffer, 60);

    await audioContext.close();

    return {
      audioBuffer,
      silences,
      speechSegments,
      wavBase64
    };
  } catch (err) {
    console.warn('Audio analysis warning:', err);
    return {
      audioBuffer: null,
      silences: [],
      speechSegments: [],
      wavBase64: null
    };
  }
}

/**
 * Remove duplicate repeated words from subtitle text (e.g. "the the", "I I", "we we")
 */
export function removeRepetitiveWords(text: string): string {
  if (!text) return '';
  // Remove duplicate consecutive words (case-insensitive)
  let cleaned = text.replace(/\b(\w+)\s+\1\b/gi, '$1');
  // Remove verbal fillers
  cleaned = cleaned.replace(/\b(umm+|uhh+|ah+|basically)\b/gi, '').replace(/\s{2,}/g, ' ').trim();
  return cleaned;
}

/**
 * Encode an AudioBuffer into 16kHz 16-bit Mono WAV format and return base64
 */
function encodeAudioBufferToWavBase64(audioBuffer: AudioBuffer, maxSeconds = 60): string {
  const targetSampleRate = 16000;
  const numChannels = 1;
  const inputChannelData = audioBuffer.getChannelData(0);
  const inputSampleRate = audioBuffer.sampleRate;

  // Limit max length
  const maxSamples = Math.min(inputChannelData.length, Math.floor(inputSampleRate * maxSeconds));
  const outputLength = Math.floor(maxSamples * (targetSampleRate / inputSampleRate));

  // Downsample to 16kHz
  const downsampled = new Float32Array(outputLength);
  for (let i = 0; i < outputLength; i++) {
    const inputIndex = Math.floor(i * (inputSampleRate / targetSampleRate));
    downsampled[i] = inputChannelData[inputIndex] || 0;
  }

  // Create WAV bytes
  const bytesPerSample = 2; // 16-bit
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = targetSampleRate * blockAlign;
  const dataSize = outputLength * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  // RIFF identifier
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, 'WAVE');

  // fmt sub-chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // SubChunk1Size (16 for PCM)
  view.setUint16(20, 1, true);  // AudioFormat (1 for PCM)
  view.setUint16(22, numChannels, true);
  view.setUint32(24, targetSampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // bits per sample

  // data sub-chunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  // PCM samples
  let offset = 44;
  for (let i = 0; i < outputLength; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, downsampled[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }

  // Convert binary ArrayBuffer to base64
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function writeString(view: DataView, offset: number, string: string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}
