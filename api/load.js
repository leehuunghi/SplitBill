import { readAppData } from './_utils.js';

export default async function handler(_req, res) {
  try {
    const data = await readAppData();
    res.status(200).json(data);
  } catch (_error) {
    res.status(200).json({
      members: [],
      expenses: [],
      payments: [],
      treasurerAccount: '',
      treasurerBankBin: '',
      treasurerAccountNo: '',
      treasurerAccountName: '',
      qrCache: {},
      nextMemberId: 1,
    });
  }
}
