export type ConsentSendPermission = {
  allowed: boolean;
  visitorToken?: string | null;
};

export type ConsentSendGate = {
  request: () => Promise<ConsentSendPermission>;
  finish: (permission: ConsentSendPermission) => void;
  cancel: () => void;
};

/**
 * Coordinates the one message that opened the consent dialog.
 *
 * A second Enter/click while that dialog is open must not subscribe another
 * outbound message to the same grant, otherwise one confirmation can release
 * duplicate requests.
 */
export function createConsentSendGate(onOpen: () => void): ConsentSendGate {
  let pendingResolve: ((permission: ConsentSendPermission) => void) | null = null;

  return {
    request() {
      if (pendingResolve) return Promise.resolve({ allowed: false });

      const promise = new Promise<ConsentSendPermission>((resolve) => {
        pendingResolve = resolve;
      });
      onOpen();
      return promise;
    },
    finish(permission) {
      const resolve = pendingResolve;
      pendingResolve = null;
      resolve?.(permission);
    },
    cancel() {
      const resolve = pendingResolve;
      pendingResolve = null;
      resolve?.({ allowed: false });
    },
  };
}
