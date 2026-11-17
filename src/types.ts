export type UnitType = 'g' | 'ml' | '個' | '枚' | '袋' | '本' | 'パック';

export const UNIT_OPTIONS: UnitType[] = ['g', 'ml', '個', '枚', '袋', '本', 'パック'];

export interface Store {
  id: string;
  name: string;
  memo: string;
  pointInfo: string;
  paymentInfo: string;
  createdAt: number;
}

export interface PriceRecord {
  id: string;
  janCode: string;
  productName: string;
  storeId: string;
  priceTaxIncluded: number;
  quantity: number;
  unit: UnitType;
  unitPrice: number;       // 算出された税込単価
  unitPriceBase: number;   // g, ml は 100、それ以外は 1
  recordedDate: string;    // YYYY-MM-DD (JST)
  isSale: boolean;
  memo: string;
  createdAt: number;
}

export interface ShoppingItem {
  id: string;
  productName: string;
  janCode: string;
  memo: string;
  completed: boolean;
  createdAt: number;
}

/**
 * 1. 日本時間 (JST: UTC+9) の現在日付を YYYY-MM-DD 形式で返す
 */
export const getTodayJST = (): string => {
  const now = new Date();
  const jstTime = new Date(now.getTime() + (9 * 60 + now.getTimezoneOffset()) * 60 * 1000);
  const year = jstTime.getFullYear();
  const month = String(jstTime.getMonth() + 1).padStart(2, '0');
  const day = String(jstTime.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

/**
 * 2. 容量あたりの税込単価を計算する
 * g, ml の場合は「100g / 100mlあたり」、それ以外は「1単位あたり」で小数点第2位まで算出
 */
export const calculateUnitPrice = (
  priceTaxIncluded: number,
  quantity: number,
  unit: UnitType
): { unitPrice: number; unitPriceBase: number } => {
  const base = unit === 'g' || unit === 'ml' ? 100 : 1;
  if (!priceTaxIncluded || !quantity || quantity <= 0) {
    return { unitPrice: 0, unitPriceBase: base };
  }
  const raw = (priceTaxIncluded / quantity) * base;
  const unitPrice = Math.round(raw * 100) / 100;
  return { unitPrice, unitPriceBase: base };
};

/**
 * 3. 全価格データと店舗情報を結合し、UTF-8 BOM付きCSVとしてダウンロードする
 */
export const exportToCSV = (records: PriceRecord[], stores: Store[]) => {
  const storeMap = new Map(stores.map((s) => [s.id, s]));

  const headers = [
    '記録日',
    'JANコード',
    '商品名',
    '店舗名',
    '税込価格(円)',
    '容量',
    '単位',
    '単価基準',
    '単価(円)',
    '区分',
    'メモ',
    '店舗ポイント情報',
    '店舗支払い情報',
  ];

  const escapeCSV = (val: string | number | boolean) => {
    const str = String(val ?? '');
    if (str.includes('"') || str.includes(',') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const rows = records.map((r) => {
    const store = storeMap.get(r.storeId);
    return [
      r.recordedDate,
      r.janCode ? `="${r.janCode}"` : '', // Excelで先頭0落ちや指数表記になるのを防止
      r.productName,
      store?.name || '不明な店舗',
      r.priceTaxIncluded,
      r.quantity,
      r.unit,
      `${r.unitPriceBase}${r.unit}あたり`,
      r.unitPrice,
      r.isSale ? '特売' : '通常',
      r.memo,
      store?.pointInfo || '',
      store?.paymentInfo || '',
    ].map(escapeCSV).join(',');
  });

  // 先頭に '\uFEFF' (BOM) を付与してExcelでの文字化けを防止
  const csvContent = '\uFEFF' + [headers.join(','), ...rows].join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', `kaimono_records_${getTodayJST()}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};