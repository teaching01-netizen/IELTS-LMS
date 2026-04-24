export function getFullscreenElement(): Element | null {
  return (
    document.fullscreenElement ??
    (
      document as Document & {
        webkitFullscreenElement?: Element | null;
      }
    ).webkitFullscreenElement ??
    null
  );
}

export function isAppleMobileDevice(userAgent: string = navigator.userAgent): boolean {
  if (/(iPhone|iPad|iPod)/i.test(userAgent)) {
    return true;
  }

  const navigatorWithTouch = navigator as Navigator & { maxTouchPoints?: number };
  if (/Macintosh/i.test(userAgent) && (/(Mobile|CriOS|FxiOS|EdgiOS)/i.test(userAgent) || (navigatorWithTouch.maxTouchPoints ?? 0) > 1)) {
    return true;
  }

  return false;
}

function getAllowKeyboardInputFlag(): number | undefined {
  const elementConstructor = (window as Window & { Element?: typeof Element }).Element;
  const flag = (elementConstructor as unknown as { ALLOW_KEYBOARD_INPUT?: number } | undefined)
    ?.ALLOW_KEYBOARD_INPUT;
  return typeof flag === 'number' ? flag : undefined;
}

export async function requestWebkitFullscreen(element: HTMLElement): Promise<boolean> {
  const allowKeyboardInputFlag = getAllowKeyboardInputFlag();
  const webkitElement = element as HTMLElement & {
    webkitRequestFullscreen?: (allowKeyboardInput?: number) => Promise<void> | void;
    webkitRequestFullScreen?: (allowKeyboardInput?: number) => Promise<void> | void;
  };

  if (typeof webkitElement.webkitRequestFullscreen === 'function') {
    await Promise.resolve(webkitElement.webkitRequestFullscreen(allowKeyboardInputFlag));
    return true;
  }

  if (typeof webkitElement.webkitRequestFullScreen === 'function') {
    await Promise.resolve(webkitElement.webkitRequestFullScreen(allowKeyboardInputFlag));
    return true;
  }

  return false;
}

export async function requestStudentFullscreen(element: HTMLElement = document.documentElement): Promise<boolean> {
  if (getFullscreenElement()) {
    return true;
  }

  if (isAppleMobileDevice()) {
    const requested = await requestWebkitFullscreen(element);
    if (requested) {
      await Promise.resolve();
      return Boolean(getFullscreenElement());
    }
  }

  if (typeof element.requestFullscreen === 'function') {
    await element.requestFullscreen({ navigationUI: 'hide' });
    await Promise.resolve();
    return Boolean(getFullscreenElement());
  }

  const requested = await requestWebkitFullscreen(element);
  if (requested) {
    await Promise.resolve();
    return Boolean(getFullscreenElement());
  }

  return false;
}
