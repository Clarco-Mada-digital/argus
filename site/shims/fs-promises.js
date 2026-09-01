/** `node:fs/promises` : la meme carte memoire, en asynchrone. */
import { promises } from './fs.js';

export const { readdir, stat, realpath, readFile } = promises;
export default promises;
