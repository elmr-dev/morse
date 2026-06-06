import { afterEach } from 'vitest';

// Mock HTMLAudioElement for testing
class MockAudio {
  src = '';
  currentTime = 0;

  private eventListeners: Map<string, Set<EventListener>> = new Map();

  load() {}

  play() {
    this.dispatchEvent(new Event('play'));
    return Promise.resolve();
  }

  pause() {}

  addEventListener(event: string, listener: EventListener) {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(listener);
  }

  removeEventListener(event: string, listener: EventListener) {
    this.eventListeners.get(event)?.delete(listener);
  }

  dispatchEvent(event: Event) {
    const listeners = this.eventListeners.get(event.type);
    listeners?.forEach(listener => listener(event));
    return true;
  }

  // Helper for tests to simulate events
  simulateCanPlayThrough() {
    this.dispatchEvent(new Event('canplaythrough'));
  }

  simulateEnded() {
    this.dispatchEvent(new Event('ended'));
  }

  simulateError() {
    this.dispatchEvent(new Event('error'));
  }
}

// @ts-expect-error - Mock Audio constructor
global.Audio = MockAudio;

// Clean up after each test
afterEach(() => {
  // Reset any global state if needed
});
