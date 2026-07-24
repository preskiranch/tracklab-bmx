export function createCommentaryCapacity(limit = 4) {
  const maximum = Math.max(1, Math.floor(Number(limit) || 1));
  let active = 0;

  return {
    get active() {
      return active;
    },
    get limit() {
      return maximum;
    },
    tryAcquire() {
      if (active >= maximum) {
        return null;
      }

      active += 1;
      let released = false;
      return () => {
        if (released) {
          return;
        }
        released = true;
        active = Math.max(0, active - 1);
      };
    },
  };
}
