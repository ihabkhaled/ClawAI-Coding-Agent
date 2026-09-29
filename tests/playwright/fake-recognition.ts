import type { Page } from '@playwright/test';

/** A scripted stand-in for the Web Speech recogniser the dictation button drives. */
export interface FakeRecognitionWindow {
  webkitSpeechRecognition?: unknown;
  __recognition?: {
    emit: (transcripts: [string, boolean][]) => void;
    fail: (code: string) => void;
    stopped: boolean;
  };
}

export async function installFakeRecognition(page: Page): Promise<void> {
  await page.evaluate(() => {
    const target = window as unknown as FakeRecognitionWindow;
    class FakeRecognition extends EventTarget {
      continuous = false;
      interimResults = false;
      lang = '';
      stopped = false;
      constructor() {
        super();
        target.__recognition = {
          stopped: false,
          emit: (transcripts) => {
            const event = new Event('result') as Event & { results: unknown };
            event.results = transcripts.map(([transcript, isFinal]) =>
              Object.assign([{ transcript }], { isFinal }),
            );
            this.dispatchEvent(event);
          },
          fail: (code) => {
            const event = new Event('error') as Event & { error: string };
            event.error = code;
            this.dispatchEvent(event);
            this.dispatchEvent(new Event('end'));
          },
        };
      }
      start(): void {
        this.stopped = false;
      }
      stop(): void {
        if (target.__recognition) {
          target.__recognition.stopped = true;
        }
        this.dispatchEvent(new Event('end'));
      }
    }
    Object.assign(window, {
      SpeechRecognition: FakeRecognition,
      webkitSpeechRecognition: FakeRecognition,
    });
  });
}
