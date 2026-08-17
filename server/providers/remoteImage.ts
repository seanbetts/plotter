import {
  cancelResponse,
  createBoundarySignal,
  defaultProviderBoundaryDependencies,
  type ProviderBoundaryDependencies,
  validatePublicHttpUrl,
} from './network';

const MAX_IMAGE_BYTES = 50 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const IMAGE_TIMEOUT_MS = 5_000;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);
const FETCH_ERROR = 'Unable to fetch image.';
const validationMessages = {
  invalid: 'Enter a valid image URL.',
  protocol: 'Image URLs must use http or https.',
  nonPublic: 'Enter a public image URL.',
  unresolved: 'Unable to resolve image URL host.',
};
const stableErrors = new Set([
  validationMessages.invalid,
  validationMessages.protocol,
  validationMessages.nonPublic,
  validationMessages.unresolved,
  'Too many redirects while fetching image.',
  'Redirect response is missing a Location header.',
  FETCH_ERROR,
  'Selected result did not return a supported image.',
  'Selected image is too large.',
  'Selected image was empty.',
]);

function throwRedactedFetchError(): never {
  throw new Error(FETCH_ERROR);
}

function contentType(response: Response): string {
  return (response.headers.get('content-type') ?? '').split(';', 1)[0]!.trim().toLowerCase();
}

async function boundedImageStream(
  response: Response,
  signal: AbortSignal,
  cleanupBoundary: () => void,
): Promise<ReadableStream<Uint8Array>> {
  if (!response.body) {
    cleanupBoundary();
    throw new Error('Selected image was empty.');
  }
  const reader = response.body.getReader();
  const releaseReader = () => {
    try {
      reader.releaseLock();
    } catch {
      // A pending read releases the lock after its cancellation settles.
    }
  };
  let first: { done: boolean; value?: Uint8Array };
  try {
    first = await new Promise((resolve, reject) => {
      let settled = false;
      const removeAbortListener = () => signal.removeEventListener('abort', abortInitialRead);
      const abortInitialRead = () => {
        if (settled) return;
        settled = true;
        removeAbortListener();
        void reader.cancel().catch(() => undefined).finally(releaseReader);
        reject(new Error(FETCH_ERROR));
      };
      signal.addEventListener('abort', abortInitialRead, { once: true });
      if (signal.aborted) {
        abortInitialRead();
        return;
      }
      reader.read().then(
        (result) => {
          if (settled) return;
          settled = true;
          removeAbortListener();
          resolve(result);
        },
        () => {
          if (settled) return;
          settled = true;
          removeAbortListener();
          reject(new Error(FETCH_ERROR));
        },
      );
    });
  } catch {
    releaseReader();
    cleanupBoundary();
    throw new Error(FETCH_ERROR);
  }
  if (first.done || !first.value || first.value.byteLength === 0) {
    await reader.cancel().catch(() => undefined);
    releaseReader();
    cleanupBoundary();
    throw new Error('Selected image was empty.');
  }
  if (first.value.byteLength > MAX_IMAGE_BYTES) {
    await reader.cancel().catch(() => undefined);
    releaseReader();
    cleanupBoundary();
    throw new Error('Selected image is too large.');
  }

  let byteCount = first.value.byteLength;
  let finalized = false;
  let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
  const finish = () => {
    if (finalized) return;
    finalized = true;
    signal.removeEventListener('abort', abortStream);
    try {
      reader.releaseLock();
    } catch {
      // A pending read releases the lock after it settles.
    }
    cleanupBoundary();
  };
  const abortStream = () => {
    if (finalized) return;
    streamController?.error(new Error(FETCH_ERROR));
    void reader.cancel().finally(finish);
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller;
      signal.addEventListener('abort', abortStream, { once: true });
      if (signal.aborted) {
        abortStream();
        return;
      }
      controller.enqueue(first.value!);
    },
    async pull(controller) {
      if (finalized) return;
      try {
        const next = await reader.read();
        if (next.done) {
          controller.close();
          finish();
          return;
        }
        byteCount += next.value.byteLength;
        if (byteCount > MAX_IMAGE_BYTES) {
          await reader.cancel().catch(() => undefined);
          controller.error(new Error('Selected image is too large.'));
          finish();
          return;
        }
        controller.enqueue(next.value);
      } catch {
        if (!finalized) controller.error(new Error(FETCH_ERROR));
        finish();
      }
    },
    async cancel(reason) {
      if (!finalized) await reader.cancel(reason).catch(() => undefined);
      finish();
    },
  });
  return stream;
}

export function createRemoteImageProvider(
  dependencies: ProviderBoundaryDependencies = defaultProviderBoundaryDependencies,
): (
  input: { url: string },
  signal: AbortSignal,
) => Promise<{ bytes: ReadableStream<Uint8Array>; contentType: string }> {
  return async ({ url: initialUrl }, externalSignal) => {
    const boundarySignal = createBoundarySignal(externalSignal, dependencies, IMAGE_TIMEOUT_MS);
    let boundaryOwnedByStream = false;
    try {
      let currentUrl = initialUrl;
      let response: Response | undefined;
      for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
        const validated = await validatePublicHttpUrl(
          currentUrl, dependencies, validationMessages, boundarySignal.signal,
        );
        try {
          response = await dependencies.fetch(validated.url, {
            method: 'GET',
            headers: {
              accept: 'image/webp,image/png,image/jpeg,image/gif,*/*;q=0.8',
              'user-agent': 'PlotterImageImport/1.0',
            },
            redirect: 'manual',
            signal: boundarySignal.signal,
          }, validated.addresses);
        } catch {
          throw new Error(FETCH_ERROR);
        }

        if (!REDIRECT_STATUSES.has(response.status)) break;
        await cancelResponse(response);
        if (redirectCount >= MAX_REDIRECTS) {
          throw new Error('Too many redirects while fetching image.');
        }
        const location = response.headers.get('location');
        if (!location) throw new Error('Redirect response is missing a Location header.');
        try {
          currentUrl = new URL(location, validated.url).toString();
        } catch {
          throw new Error(FETCH_ERROR);
        }
      }

      if (!response) throw new Error(FETCH_ERROR);
      if (!response.ok) {
        await cancelResponse(response);
        throw new Error(FETCH_ERROR);
      }
      const normalizedContentType = contentType(response);
      if (!ALLOWED_IMAGE_TYPES.has(normalizedContentType)) {
        await cancelResponse(response);
        throw new Error('Selected result did not return a supported image.');
      }
      const declaredLength = Number(response.headers.get('content-length') ?? '');
      if (Number.isFinite(declaredLength) && declaredLength > MAX_IMAGE_BYTES) {
        await cancelResponse(response);
        throw new Error('Selected image is too large.');
      }

      const bytes = await boundedImageStream(response, boundarySignal.signal, boundarySignal.cleanup);
      boundaryOwnedByStream = true;
      return { bytes, contentType: normalizedContentType };
    } catch (error) {
      if (error instanceof Error && stableErrors.has(error.message)) throw error;
      throwRedactedFetchError();
    } finally {
      if (!boundaryOwnedByStream) boundarySignal.cleanup();
    }
  };
}

export function fetchRemoteImage(
  input: { url: string },
  signal: AbortSignal,
): Promise<{ bytes: ReadableStream<Uint8Array>; contentType: string }> {
  return createRemoteImageProvider()(input, signal);
}
