/**
 * @file useVoiceRecorder.wav.test.ts
 * @description 验证 wav 编码器的头部格式和最小体积。
 */
import { describe, expect, it } from 'vitest';
import { encodeWavePcm16Mono } from '@/components/BChatSidebar/hooks/useVoiceRecorder';

describe('encodeWavePcm16Mono', () => {
  it('encodes mono 16kHz pcm as wav', () => {
    const input = new Float32Array(16000).fill(0);
    const wav = encodeWavePcm16Mono(input, 16000);
    const header = Array.from(new Uint8Array(wav.slice(0, 4)));

    expect(header).toEqual([82, 73, 70, 70]);
    expect(wav.byteLength).toBeGreaterThan(44);
  });
});
