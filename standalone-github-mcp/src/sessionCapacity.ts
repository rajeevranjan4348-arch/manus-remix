export class SessionCapacity {
  private pendingReservations = 0;

  reserve(activeSessions: number, maxSessions: number): (() => void) | undefined {
    if (activeSessions + this.pendingReservations >= maxSessions) return undefined;
    this.pendingReservations += 1;
    let held = true;
    return () => {
      if (!held) return;
      held = false;
      this.pendingReservations -= 1;
    };
  }
}
