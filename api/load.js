import { readDataFile } from './_utils.js';

export default async function handler(_req, res) {
  const data = await readDataFile();
  res.status(200).json(data);
}
