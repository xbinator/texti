/**
 * @file screen-projector.test.ts
 * @description PTY 原始数据到当前 Screen Snapshot 的投影测试。
 */
import { describe, expect, it } from 'vitest';
import { createScreenProjector } from '../../../../../electron/main/modules/shell/interaction/screen-projector.mts';

describe('TerminalSnapshotProjector', (): void => {
  it('returns to column zero for pipe line feeds when convertEol is enabled', async (): Promise<void> => {
    const projector = createScreenProjector({ columns: 40, rows: 8, convertEol: true });

    await projector.write('alpha\nbeta\ngamma');

    expect(projector.snapshot(Date.now()).content).toBe('alpha\nbeta\ngamma');
    projector.dispose();
  });

  it('applies carriage-return redraw instead of appending raw text', async (): Promise<void> => {
    const projector = createScreenProjector({ columns: 40, rows: 6 });

    await projector.write('Downloading 10%\rDownloading 90%');
    const snapshot = projector.snapshot(100);

    expect(snapshot.content).toContain('Downloading 90%');
    expect(snapshot.content).not.toContain('Downloading 10%Downloading');
    projector.dispose();
  });

  it('returns a bounded current screen and sanitized scrollback output', async (): Promise<void> => {
    const projector = createScreenProjector({ columns: 20, rows: 3 });

    await projector.write(`\u001b[31m${'x'.repeat(80)}\u001b[0m`);
    const snapshot = projector.snapshot(200, 30);
    const output = projector.projectOutput(25);

    expect(snapshot.content.length).toBeLessThanOrEqual(30);
    expect(output.content.length).toBeLessThanOrEqual(25);
    expect(snapshot.content).not.toContain('\u001b[');
    expect(output.content).not.toContain('\u001b[');
    expect(output.truncated).toBe(true);
    projector.dispose();
  });

  it('does not silently discard short lines before reaching the character limit', async (): Promise<void> => {
    const projector = createScreenProjector({ columns: 80, rows: 24 });
    const input = Array.from({ length: 1_500 }, (_value: unknown, index: number): string => String(index).padStart(4, '0')).join('\r\n');

    await projector.write(input);
    const output = projector.projectOutput(20_000);

    expect(output.content).toContain('0000');
    expect(output.content).toContain('1499');
    expect(output.truncated).toBe(false);
    projector.dispose();
  });
});
