/*
 * Turning a picked image into the photograph a .ftree carries.
 *
 * The numbers here are not this app's to choose. `PhotoStore.STORED_EDGE` is 512 and `QUALITY` is
 * 85, and a desktop-written file has to be indistinguishable from a phone-written one -- not for
 * tidiness, but because the same tree gets carried back and forth between them, and a photograph
 * that changes size and weight every time it crosses is a file that grows without anybody adding
 * anything.
 *
 * The geometry is separated from the canvas so it can be tested. Which square comes out of an image
 * is arithmetic; drawing it is not.
 */

/** `PhotoStore.STORED_EDGE` -- a face at 512px is sharper than any circle this app draws can show. */
export const STORED_EDGE = 512;

/** `PhotoStore.QUALITY`. */
export const QUALITY = 85;

/**
 * The square to cut, given the image and how far the reader has dragged it.
 *
 * The square is always the largest that fits -- the shorter edge -- and the drag only decides
 * *where along the longer edge* it sits. That is the whole interaction: a portrait can be moved up
 * to the face and a group photo across to one person, and nothing else is offered, because
 * anything else is a crop dialog and this is not one.
 *
 * `offset` is a fraction from 0 to 1 of the travel available, so it survives the image being
 * displayed at any size. Clamped rather than trusted, as `saveCrop` clamps: a square that runs off
 * the edge of the picture would be transparent there, and this format has no alpha.
 */
export function squareCrop(width, height, offset = 0.5) {
  const size = Math.max(0, Math.min(width, height));
  if (!size) return { x: 0, y: 0, size: 0 };

  const fraction = Number.isFinite(offset) ? Math.min(1, Math.max(0, offset)) : 0.5;
  const slack = Math.max(width, height) - size;
  const along = Math.round(slack * fraction);

  return width >= height
    ? { x: along, y: 0, size }
    : { x: 0, y: along, size };
}

/**
 * Whether the square needs scaling on the way in, and to what.
 *
 * `saveCrop` scales down and never up: a 200px photograph stays 200px rather than being blown up to
 * 512 and stored four times as heavy for no more detail than it started with.
 */
export function storedEdge(cropSize) {
  return cropSize <= STORED_EDGE ? cropSize : STORED_EDGE;
}

/**
 * A name for a photograph nobody else in this tree is using.
 *
 * `photos/<uuid>.jpg`, matching what the app writes and what the importer expects. The collision
 * check is not superstition -- import can bring photographs in under names chosen by another
 * machine, and two people quietly sharing an entry means replacing one person's face replaces the
 * other's too.
 */
export function freeName(taken, uuid = () => crypto.randomUUID()) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const name = `photos/${uuid()}.jpg`;
    if (!taken.has(name)) return name;
  }
  // Eight collisions on a v4 uuid is not a thing that happens; refusing beats overwriting a face.
  return null;
}

/* ------------------------------------------------------------------ the canvas half */

/** Decodes bytes into something drawable, or null if it is not an image this machine can read. */
export async function decode(bytes) {
  const blob = new Blob([bytes]);
  try {
    return await createImageBitmap(blob);
  } catch {
    return null;
  }
}

/**
 * Cuts the framed square out and encodes it exactly as the phone would.
 *
 * Square about the drag, longest edge 512, JPEG at quality 85. The circle every surface draws is a
 * matter of display, not of storage: a round image would have to be a PNG with an alpha channel,
 * several times the size, to save a shape that everything showing it already draws for itself.
 */
export async function encode(bitmap, offset = 0.5) {
  const crop = squareCrop(bitmap.width, bitmap.height, offset);
  if (!crop.size) return null;

  const edge = storedEdge(crop.size);
  const canvas = document.createElement('canvas');
  canvas.width = edge;
  canvas.height = edge;

  const context = canvas.getContext('2d');
  // Nothing here has an alpha channel and JPEG cannot carry one, so a transparent source would
  // otherwise come out black rather than white.
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, edge, edge);
  context.imageSmoothingQuality = 'high';
  context.drawImage(bitmap, crop.x, crop.y, crop.size, crop.size, 0, 0, edge, edge);

  const blob = await new Promise((resolve) => {
    canvas.toBlob(resolve, 'image/jpeg', QUALITY / 100);
  });
  if (!blob) return null;
  return new Uint8Array(await blob.arrayBuffer());
}

/** A data URL for showing stored bytes, since the page cannot reach the file they came from. */
export function asImageUrl(bytes) {
  if (!bytes) return null;
  return URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }));
}
