import React, { useState, useEffect, useMemo } from 'react';
import {
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  type User,
} from 'firebase/auth';
import {
  collection,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  query,
  orderBy,
  type FirestoreError,
} from 'firebase/firestore';
import {
  Search,
  PlusCircle,
  ShoppingCart,
  Store as StoreIcon,
  Camera,
  Tag,
  Award,
  CreditCard,
  Coins,
  Trash2,
  Edit3,
  Check,
  Download,
  LogOut,
  ChevronRight,
  Calculator,
  History,
  Info,
  X,
} from 'lucide-react';
import { auth, googleProvider, db } from './firebase'; // ← ALLOWED_EMAILS を削除
import {
  type Store,
  type PriceRecord,
  type ShoppingItem,
  type UnitType,
  UNIT_OPTIONS,
  getTodayJST,
  calculateUnitPrice,
  exportToCSV,
} from './types';
import { BarcodeScanner } from './components/BarcodeScanner';

type TabType = 'compare' | 'register' | 'list' | 'stores';

export default function App() {
  // --- 認証・権限ステート ---
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState<boolean>(true);
  const [isUnauthorized, setIsUnauthorized] = useState<boolean>(false); // ← 追加: 権限拒否検知用

  // --- 画面遷移・モーダル管理 ---
  const [activeTab, setActiveTab] = useState<TabType>('compare');
  const [scannerTarget, setScannerTarget] = useState<'search' | 'form' | null>(null);
  const [selectedStoreDetail, setSelectedStoreDetail] = useState<Store | null>(null);
  const [selectedProductKey, setSelectedProductKey] = useState<string | null>(null);

  // --- Firestore リアルタイムデータ ---
  const [stores, setStores] = useState<Store[]>([]);
  const [records, setRecords] = useState<PriceRecord[]>([]);
  const [shoppingList, setShoppingList] = useState<ShoppingItem[]>([]);

  // --- (A) 価格登録フォーム用ステート ---
  const [editingRecordId, setEditingRecordId] = useState<string | null>(null);
  const [janCode, setJanCode] = useState<string>('');
  const [productName, setProductName] = useState<string>('');
  const [storeId, setStoreId] = useState<string>('');
  const [priceInput, setPriceInput] = useState<string>('');
  const [quantityInput, setQuantityInput] = useState<string>('1');
  const [unit, setUnit] = useState<UnitType>('個');
  const [recordedDate, setRecordedDate] = useState<string>(getTodayJST());
  const [isSale, setIsSale] = useState<boolean>(false);
  const [memo, setMemo] = useState<string>('');
  const [formFeedback, setFormFeedback] = useState<string>('');

  // --- (B) 検索用ステート ---
  const [searchQuery, setSearchQuery] = useState<string>('');

  // --- (C) 店舗管理フォーム用ステート ---
  const [editingStoreId, setEditingStoreId] = useState<string | null>(null);
  const [storeName, setStoreName] = useState<string>('');
  const [storeMemo, setStoreMemo] = useState<string>('');
  const [pointInfo, setPointInfo] = useState<string>('');
  const [paymentInfo, setPaymentInfo] = useState<string>('');

  // --- (D) 買い物リスト入力用ステート ---
  const [newListItemName, setNewListItemName] = useState<string>('');
  const [newListItemMemo, setNewListItemMemo] = useState<string>('');

  // 1. Firebase ログイン状態の監視
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setIsUnauthorized(false);
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // 2. Firestore 3コレクションのリアルタイム同期（権限エラーのハンドリング付き）
  useEffect(() => {
    if (!user) return;

    const handleSnapshotError = (error: FirestoreError) => {
      if (error.code === 'permission-denied') {
        setIsUnauthorized(true);
      } else {
        console.error('Firestore error:', error);
      }
    };

    const qStores = query(collection(db, 'stores'), orderBy('createdAt', 'asc'));
    const unsubStores = onSnapshot(
      qStores,
      (snapshot) => {
        setIsUnauthorized(false);
        const data: Store[] = snapshot.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<Store, 'id'>),
        }));
        setStores(data);
      },
      handleSnapshotError
    );

    const qRecords = query(collection(db, 'priceRecords'), orderBy('recordedDate', 'desc'));
    const unsubRecords = onSnapshot(
      qRecords,
      (snapshot) => {
        const data: PriceRecord[] = snapshot.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<PriceRecord, 'id'>),
        }));
        setRecords(data);
      },
      handleSnapshotError
    );

    const qList = query(collection(db, 'shoppingList'), orderBy('createdAt', 'desc'));
    const unsubList = onSnapshot(
      qList,
      (snapshot) => {
        const data: ShoppingItem[] = snapshot.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<ShoppingItem, 'id'>),
        }));
        setShoppingList(data);
      },
      handleSnapshotError
    );

    return () => {
      unsubStores();
      unsubRecords();
      unsubList();
    };
  }, [user]);

  // 店舗IDから店舗情報を高速に引くMap
  const storeMap = useMemo(() => {
    return new Map(stores.map((s) => [s.id, s]));
  }, [stores]);

  // 過去に登録した商品名の一覧（入力サジェスト用）
  const existingProductNames = useMemo(() => {
    const set = new Set<string>();
    records.forEach((r) => {
      if (r.productName) set.add(r.productName);
    });
    return Array.from(set);
  }, [records]);

  // JANコードが入力/スキャンされた際、過去データがあれば商品名と容量を自動補完
  const handleJanCodeChange = (code: string) => {
    setJanCode(code);
    const trimmed = code.trim();
    if (trimmed.length >= 8) {
      const matched = records.find((r) => r.janCode === trimmed);
      if (matched) {
        setProductName(matched.productName);
        setQuantityInput(String(matched.quantity));
        setUnit(matched.unit);
        setFormFeedback(`登録済みの「${matched.productName}」を自動補完しました`);
        setTimeout(() => setFormFeedback(''), 3500);
      }
    }
  };

  // 税抜価格から8%または10%の税込価格へ変換する補助ボタン処理
  const applyTaxCalculation = (taxRate: 1.08 | 1.1) => {
    const num = parseFloat(priceInput);
    if (isNaN(num) || num <= 0) return;
    const taxIncluded = Math.floor(num * taxRate);
    setPriceInput(String(taxIncluded));
  };

  // フォーム入力中のリアルタイム単価プレビュー
  const currentUnitPricePreview = useMemo(() => {
    const p = parseFloat(priceInput) || 0;
    const q = parseFloat(quantityInput) || 0;
    return calculateUnitPrice(p, q, unit);
  }, [priceInput, quantityInput, unit]);

  // 価格記録の保存処理
  const handleSaveRecord = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!productName.trim() || !storeId || !priceInput) return;

    const priceNum = Math.round(parseFloat(priceInput));
    const quantityNum = parseFloat(quantityInput) || 1;
    const { unitPrice, unitPriceBase } = calculateUnitPrice(priceNum, quantityNum, unit);

    const payload = {
      janCode: janCode.trim(),
      productName: productName.trim(),
      storeId,
      priceTaxIncluded: priceNum,
      quantity: quantityNum,
      unit,
      unitPrice,
      unitPriceBase,
      recordedDate,
      isSale,
      memo: memo.trim(),
      createdAt: Date.now(),
    };

    if (editingRecordId) {
      await updateDoc(doc(db, 'priceRecords', editingRecordId), payload);
      setFormFeedback('価格データを更新しました');
    } else {
      await addDoc(collection(db, 'priceRecords'), payload);
      setFormFeedback('価格データを登録しました');
    }

    setEditingRecordId(null);
    setJanCode('');
    setProductName('');
    setStoreId('');
    setPriceInput('');
    setQuantityInput('1');
    setIsSale(false);
    setMemo('');
    setTimeout(() => setFormFeedback(''), 3000);
  };

  const startEditRecord = (rec: PriceRecord) => {
    setEditingRecordId(rec.id);
    setJanCode(rec.janCode);
    setProductName(rec.productName);
    setStoreId(rec.storeId);
    setPriceInput(String(rec.priceTaxIncluded));
    setQuantityInput(String(rec.quantity));
    setUnit(rec.unit);
    setRecordedDate(rec.recordedDate);
    setIsSale(rec.isSale);
    setMemo(rec.memo);
    setActiveTab('register');
  };

  const handleDeleteRecord = async (id: string) => {
    if (!window.confirm('この価格記録を削除しますか？')) return;
    await deleteDoc(doc(db, 'priceRecords', id));
  };

  // 商品ごとの店舗別最新価格・最安値の集計
  const groupedProducts = useMemo(() => {
    const groups = new Map<
      string,
      {
        key: string;
        productName: string;
        janCode: string;
        allRecords: PriceRecord[];
        latestByStore: PriceRecord[];
        minTotalPrice: number;
        minUnitPrice: number;
      }
    >();

    const sorted = [...records].sort((a, b) => {
      if (b.recordedDate !== a.recordedDate) {
        return b.recordedDate.localeCompare(a.recordedDate);
      }
      return b.createdAt - a.createdAt;
    });

    for (const r of sorted) {
      const key = r.productName.trim();
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          productName: r.productName,
          janCode: r.janCode,
          allRecords: [],
          latestByStore: [],
          minTotalPrice: Infinity,
          minUnitPrice: Infinity,
        });
      }
      const g = groups.get(key)!;
      if (!g.janCode && r.janCode) g.janCode = r.janCode;
      g.allRecords.push(r);
    }

    groups.forEach((g) => {
      const seenStores = new Set<string>();
      for (const r of g.allRecords) {
        if (!seenStores.has(r.storeId)) {
          seenStores.add(r.storeId);
          g.latestByStore.push(r);
          if (r.priceTaxIncluded < g.minTotalPrice) {
            g.minTotalPrice = r.priceTaxIncluded;
          }
          if (r.unitPrice > 0 && r.unitPrice < g.minUnitPrice) {
            g.minUnitPrice = r.unitPrice;
          }
        }
      }
      g.latestByStore.sort((a, b) => a.unitPrice - b.unitPrice);
    });

    const list = Array.from(groups.values());
    if (!searchQuery.trim()) return list;

    const q = searchQuery.trim().toLowerCase();
    return list.filter(
      (item) =>
        item.productName.toLowerCase().includes(q) ||
        item.janCode.includes(q)
    );
  }, [records, searchQuery]);

  // 買い物リスト操作
  const addShoppingItem = async (name: string, jan = '', itemMemo = '') => {
    if (!name.trim()) return;
    await addDoc(collection(db, 'shoppingList'), {
      productName: name.trim(),
      janCode: jan,
      memo: itemMemo.trim(),
      completed: false,
      createdAt: Date.now(),
    });
  };

  const toggleShoppingItem = async (item: ShoppingItem) => {
    await updateDoc(doc(db, 'shoppingList', item.id), {
      completed: !item.completed,
    });
  };

  const deleteShoppingItem = async (id: string) => {
    await deleteDoc(doc(db, 'shoppingList', id));
  };

  // 店舗マスタの保存・削除
  const handleSaveStore = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!storeName.trim()) return;
    const payload = {
      name: storeName.trim(),
      memo: storeMemo.trim(),
      pointInfo: pointInfo.trim(),
      paymentInfo: paymentInfo.trim(),
      createdAt: Date.now(),
    };
    if (editingStoreId) {
      await updateDoc(doc(db, 'stores', editingStoreId), payload);
    } else {
      await addDoc(collection(db, 'stores'), payload);
    }
    setEditingStoreId(null);
    setStoreName('');
    setStoreMemo('');
    setPointInfo('');
    setPaymentInfo('');
  };

  const handleDeleteStore = async (id: string) => {
    if (!window.confirm('この店舗を削除しますか？')) return;
    await deleteDoc(doc(db, 'stores', id));
  };

  // --- 認証・ローディング表示 ---
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <p className="text-slate-500 font-medium text-sm">読み込み中...</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-slate-50">
        <div className="w-full max-w-sm bg-white rounded-3xl shadow-lg p-8 text-center border border-slate-100">
          <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <ShoppingCart className="w-8 h-8" />
          </div>
          <h1 className="text-xl font-bold text-slate-900">KaimonoCompare</h1>
          <p className="text-xs text-slate-500 mt-2 mb-6">
            2人専用の複数店舗価格比較・買い物管理アプリ
          </p>
          <button
            onClick={() => signInWithPopup(auth, googleProvider)}
            className="w-full py-3 px-4 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl shadow transition-colors text-sm"
          >
            Googleアカウントでログイン
          </button>
        </div>
      </div>
    );
  }

  // Firestoreのセキュリティルールで拒否された場合にアクセス制限画面を表示
  if (isUnauthorized) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-slate-50">
        <div className="w-full max-w-sm bg-white rounded-2xl p-6 text-center shadow">
          <p className="text-red-600 font-bold mb-2">アクセス権限がありません</p>
          <p className="text-xs text-slate-600 mb-4">
            ログイン中のアカウント（{user.email}）は許可されていません。
          </p>
          <button
            onClick={() => signOut(auth)}
            className="w-full py-2.5 bg-slate-200 text-slate-800 rounded-xl font-bold text-sm"
          >
            ログアウト
          </button>
        </div>
      </div>
    );
  }

  const uncompletedListCount = shoppingList.filter((i) => !i.completed).length;

  return (
    <div className="min-h-screen bg-slate-50 pb-24">
      {/* 上部ヘッダー */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-slate-200 px-4 py-3">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="bg-emerald-600 text-white p-1.5 rounded-lg">
              <ShoppingCart className="w-4 h-4" />
            </span>
            <h1 className="font-bold text-base text-slate-900">価格比較・買い物管理</h1>
          </div>
          <button
            onClick={() => exportToCSV(records, stores)}
            className="flex items-center gap-1 text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-lg transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            <span>CSV出力</span>
          </button>
        </div>
      </header>

      <main className="max-w-2xl mx-auto p-4">
        {/* ==================== 1. 検索・比較タブ ==================== */}
        {activeTab === 'compare' && (
          <div className="space-y-4">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="商品名またはJANコードで検索..."
                  className="w-full pl-10 pr-8 py-3 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => setScannerTarget('search')}
                className="px-3.5 bg-slate-900 text-white rounded-xl flex items-center justify-center gap-1.5 font-bold text-xs shrink-0"
              >
                <Camera className="w-4 h-4 text-emerald-400" />
                <span>JAN読取</span>
              </button>
            </div>

            {groupedProducts.length === 0 ? (
              <div className="bg-white rounded-2xl p-8 text-center border border-slate-200">
                <p className="text-sm text-slate-500 mb-3">
                  該当する商品データがありません
                </p>
                <button
                  onClick={() => {
                    if (/^\d{8,13}$/.test(searchQuery.trim())) {
                      setJanCode(searchQuery.trim());
                    } else {
                      setProductName(searchQuery.trim());
                    }
                    setActiveTab('register');
                  }}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-600 text-white text-xs font-bold rounded-xl"
                >
                  <PlusCircle className="w-4 h-4" />
                  <span>この商品を登録する</span>
                </button>
              </div>
            ) : (
              groupedProducts.map((group) => (
                <div
                  key={group.key}
                  className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden"
                >
                  <div className="p-4 bg-slate-50/70 border-b border-slate-100 flex items-start justify-between gap-2">
                    <div>
                      <h2 className="font-bold text-slate-900 text-base">
                        {group.productName}
                      </h2>
                      {group.janCode && (
                        <p className="text-[11px] text-slate-400 font-mono mt-0.5">
                          JAN: {group.janCode}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => {
                          addShoppingItem(group.productName, group.janCode);
                          alert(`「${group.productName}」を買い物リストに追加しました`);
                        }}
                        className="px-2.5 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-lg text-xs font-bold flex items-center gap-1"
                      >
                        <ShoppingCart className="w-3.5 h-3.5" />
                        <span>リスト追加</span>
                      </button>
                      <button
                        onClick={() =>
                          setSelectedProductKey(
                            selectedProductKey === group.key ? null : group.key
                          )
                        }
                        className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-bold flex items-center gap-1"
                      >
                        <History className="w-3.5 h-3.5" />
                        <span>履歴</span>
                      </button>
                    </div>
                  </div>

                  <div className="divide-y divide-slate-100">
                    {group.latestByStore.map((rec) => {
                      const store = storeMap.get(rec.storeId);
                      const isCheapestTotal = rec.priceTaxIncluded === group.minTotalPrice;
                      const isCheapestUnit = rec.unitPrice === group.minUnitPrice;

                      return (
                        <div
                          key={rec.id}
                          className={`p-3.5 flex items-center justify-between gap-3 ${
                            isCheapestUnit ? 'bg-emerald-50/40' : ''
                          }`}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <button
                                type="button"
                                onClick={() => store && setSelectedStoreDetail(store)}
                                className="font-bold text-sm text-slate-900 hover:text-emerald-600 underline decoration-slate-300 underline-offset-4 flex items-center gap-1 text-left"
                              >
                                <span>{store?.name || '不明な店舗'}</span>
                                <Info className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                              </button>

                              {isCheapestUnit && (
                                <span className="px-2 py-0.5 bg-emerald-600 text-white text-[10px] font-bold rounded-full flex items-center gap-0.5">
                                  <Award className="w-3 h-3" />
                                  単価最安
                                </span>
                              )}
                              {isCheapestTotal && (
                                <span className="px-2 py-0.5 bg-amber-500 text-white text-[10px] font-bold rounded-full">
                                  総額最安
                                </span>
                              )}
                              {rec.isSale && (
                                <span className="px-1.5 py-0.5 bg-rose-100 text-rose-700 text-[10px] font-bold rounded">
                                  特売
                                </span>
                              )}
                            </div>

                            <div className="text-xs text-slate-500 mt-1 flex items-center gap-2 flex-wrap">
                              <span>
                                容量: {rec.quantity}
                                {rec.unit}
                              </span>
                              <span>•</span>
                              <span>記録: {rec.recordedDate}</span>
                              {rec.memo && (
                                <span className="text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded">
                                  {rec.memo}
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="text-right shrink-0">
                            <div className="text-lg font-extrabold text-slate-900 leading-none">
                              {rec.priceTaxIncluded.toLocaleString()}
                              <span className="text-xs font-normal ml-0.5">円(税込)</span>
                            </div>
                            <div
                              className={`text-xs font-bold mt-1 ${
                                isCheapestUnit ? 'text-emerald-700' : 'text-slate-500'
                              }`}
                            >
                              {rec.unitPrice}円 / {rec.unitPriceBase}
                              {rec.unit}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {selectedProductKey === group.key && (
                    <div className="bg-slate-900 text-white p-4 space-y-3">
                      <h3 className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                        <History className="w-4 h-4 text-emerald-400" />
                        <span>価格推移・履歴（全{group.allRecords.length}件）</span>
                      </h3>
                      <div className="space-y-2 pt-1">
                        {group.allRecords.slice(0, 10).map((r) => {
                          const store = storeMap.get(r.storeId);
                          const maxPrice = Math.max(
                            ...group.allRecords.map((x) => x.priceTaxIncluded),
                            1
                          );
                          const widthPercent = Math.max(
                            20,
                            Math.round((r.priceTaxIncluded / maxPrice) * 100)
                          );

                          return (
                            <div
                              key={r.id}
                              className="bg-slate-800 rounded-xl p-2.5 text-xs space-y-1.5"
                            >
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <span className="text-slate-400 font-mono">
                                    {r.recordedDate}
                                  </span>
                                  <span className="font-bold text-white">
                                    {store?.name || '不明'}
                                  </span>
                                  {r.isSale && (
                                    <span className="px-1.5 py-0.2 bg-rose-500/20 text-rose-300 text-[10px] rounded">
                                      特売
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="font-bold text-emerald-400">
                                    {r.priceTaxIncluded}円
                                  </span>
                                  <span className="text-slate-400">
                                    ({r.unitPrice}円/{r.unitPriceBase}
                                    {r.unit})
                                  </span>
                                  <button
                                    onClick={() => startEditRecord(r)}
                                    className="p-1 text-slate-400 hover:text-white"
                                  >
                                    <Edit3 className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    onClick={() => handleDeleteRecord(r.id)}
                                    className="p-1 text-slate-400 hover:text-rose-400"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </div>
                              <div className="w-full bg-slate-700 h-1.5 rounded-full overflow-hidden">
                                <div
                                  className="bg-emerald-500 h-full rounded-full"
                                  style={{ width: `${widthPercent}%` }}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {/* ==================== 2. 価格登録タブ ==================== */}
        {activeTab === 'register' && (
          <form
            onSubmit={handleSaveRecord}
            className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 space-y-4"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h2 className="font-bold text-base text-slate-900">
                {editingRecordId ? '価格記録の編集' : '新規価格の登録'}
              </h2>
              {editingRecordId && (
                <button
                  type="button"
                  onClick={() => {
                    setEditingRecordId(null);
                    setJanCode('');
                    setProductName('');
                    setPriceInput('');
                  }}
                  className="text-xs text-slate-500 underline"
                >
                  新規登録に戻す
                </button>
              )}
            </div>

            {formFeedback && (
              <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-xs font-bold">
                {formFeedback}
              </div>
            )}

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                JANコード（スキャンで過去データを自動補完）
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  inputMode="numeric"
                  value={janCode}
                  onChange={(e) => handleJanCodeChange(e.target.value)}
                  placeholder="4901234567890"
                  className="flex-1 px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-mono"
                />
                <button
                  type="button"
                  onClick={() => setScannerTarget('form')}
                  className="px-4 bg-slate-900 text-white rounded-xl font-bold text-xs flex items-center gap-1.5 shrink-0"
                >
                  <Camera className="w-4 h-4 text-emerald-400" />
                  <span>カメラ読取</span>
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                商品名 <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                required
                list="product-name-suggestions"
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
                placeholder="例: 明治 おいしい牛乳"
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm"
              />
              <datalist id="product-name-suggestions">
                {existingProductNames.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                店舗 <span className="text-rose-500">*</span>
              </label>
              {stores.length === 0 ? (
                <div className="p-3 bg-amber-50 text-amber-800 rounded-xl text-xs flex items-center justify-between">
                  <span>先に店舗マスタを登録してください</span>
                  <button
                    type="button"
                    onClick={() => setActiveTab('stores')}
                    className="font-bold underline"
                  >
                    店舗管理へ
                  </button>
                </div>
              ) : (
                <select
                  value={storeId}
                  onChange={(e) => setStoreId(e.target.value)}
                  required
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium"
                >
                  <option value="" disabled>
                    選択してください
                  </option>
                  {stores.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                価格（税込・円） <span className="text-rose-500">*</span>
              </label>
              <input
                type="number"
                inputMode="numeric"
                required
                min="1"
                step="1"
                value={priceInput}
                onChange={(e) => setPriceInput(e.target.value)}
                placeholder="税抜または税込の金額を入力"
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-base font-bold"
              />
              <div className="grid grid-cols-2 gap-2 mt-2">
                <button
                  type="button"
                  onClick={() => applyTaxCalculation(1.08)}
                  className="py-2 px-3 bg-emerald-50 hover:bg-emerald-100 active:bg-emerald-200 text-emerald-800 border border-emerald-200 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-colors"
                >
                  <Calculator className="w-3.5 h-3.5 shrink-0" />
                  <span>税抜から +8%税込に変換</span>
                </button>
                <button
                  type="button"
                  onClick={() => applyTaxCalculation(1.1)}
                  className="py-2 px-3 bg-blue-50 hover:bg-blue-100 active:bg-blue-200 text-blue-800 border border-blue-200 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-colors"
                >
                  <Calculator className="w-3.5 h-3.5 shrink-0" />
                  <span>税抜から +10%税込に変換</span>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  容量（数値） <span className="text-rose-500">*</span>
                </label>
                <input
                  type="number"
                  inputMode="decimal"
                  required
                  min="0.1"
                  step="any"
                  value={quantityInput}
                  onChange={(e) => setQuantityInput(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  単位
                </label>
                <select
                  value={unit}
                  onChange={(e) => setUnit(e.target.value as UnitType)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold"
                >
                  {UNIT_OPTIONS.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="p-3 bg-slate-900 text-white rounded-xl flex items-center justify-between text-xs">
              <span className="text-slate-300">自動算出単価（税込）:</span>
              <span className="font-extrabold text-sm text-emerald-400">
                {currentUnitPricePreview.unitPrice} 円 / {currentUnitPricePreview.unitPriceBase}
                {unit}あたり
              </span>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  記録日（JST）
                </label>
                <input
                  type="date"
                  value={recordedDate}
                  onChange={(e) => setRecordedDate(e.target.value)}
                  className="appearance-none block w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-mono"
                />
              </div>

              <label className="flex items-center justify-center gap-2.5 cursor-pointer select-none p-3 rounded-xl border border-slate-200 bg-slate-50 active:bg-slate-100 transition-colors">
                <input
                  type="checkbox"
                  checked={isSale}
                  onChange={(e) => setIsSale(e.target.checked)}
                  className="w-4 h-4 accent-rose-600 rounded shrink-0"
                />
                <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                  <Tag className="w-4 h-4 text-rose-500 shrink-0" />
                  <span>特売・セール価格として記録する</span>
                </span>
              </label>
            </div>
            

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                メモ（任意）
              </label>
              <input
                type="text"
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                placeholder="例: 火曜市、クーポン適用後"
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm"
              />
            </div>

            <button
              type="submit"
              disabled={stores.length === 0 || !storeId}
              className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white font-bold rounded-xl shadow text-sm transition-colors"
            >
              {editingRecordId ? '更新を保存する' : 'この価格を登録する'}
            </button>
          </form>
        )}

        {/* ==================== 3. 買い物リストタブ ==================== */}
        {activeTab === 'list' && (
          <div className="space-y-4">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                addShoppingItem(newListItemName, '', newListItemMemo);
                setNewListItemName('');
                setNewListItemMemo('');
              }}
              className="bg-white rounded-2xl p-4 shadow-sm border border-slate-200 space-y-2.5"
            >
              <h2 className="text-xs font-bold text-slate-700">
                買うものを追加（リアルタイム同期）
              </h2>
              <div className="flex gap-2">
                <input
                  type="text"
                  list="product-name-suggestions"
                  value={newListItemName}
                  onChange={(e) => setNewListItemName(e.target.value)}
                  placeholder="商品名を入力..."
                  className="flex-1 px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm"
                />
                <button
                  type="submit"
                  className="px-4 bg-emerald-600 text-white font-bold rounded-xl text-xs shrink-0"
                >
                  追加
                </button>
              </div>
              <input
                type="text"
                value={newListItemMemo}
                onChange={(e) => setNewListItemMemo(e.target.value)}
                placeholder="補足メモ（例: 2パック）"
                className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs"
              />
            </form>

            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 divide-y divide-slate-100 overflow-hidden">
              {shoppingList.length === 0 ? (
                <p className="p-8 text-center text-sm text-slate-400">
                  買い物リストは空です
                </p>
              ) : (
                shoppingList.map((item) => (
                  <div
                    key={item.id}
                    className={`p-3.5 flex items-center justify-between gap-3 ${
                      item.completed ? 'bg-slate-50 opacity-60' : ''
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <button
                        type="button"
                        onClick={() => toggleShoppingItem(item)}
                        className={`w-6 h-6 rounded-lg border-2 flex items-center justify-center shrink-0 transition-colors ${
                          item.completed
                            ? 'bg-emerald-600 border-emerald-600 text-white'
                            : 'border-slate-300 bg-white'
                        }`}
                      >
                        {item.completed && <Check className="w-4 h-4" />}
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setSearchQuery(item.productName);
                          setActiveTab('compare');
                        }}
                        className="text-left min-w-0 flex-1 group"
                      >
                        <div
                          className={`font-bold text-sm flex items-center gap-1 ${
                            item.completed
                              ? 'line-through text-slate-400'
                              : 'text-slate-900 group-hover:text-emerald-600'
                          }`}
                        >
                          <span className="truncate">{item.productName}</span>
                          <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
                        </div>
                        {item.memo && (
                          <p className="text-xs text-slate-500 mt-0.5">{item.memo}</p>
                        )}
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() => deleteShoppingItem(item.id)}
                      className="p-2 text-slate-400 hover:text-rose-600"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* ==================== 4. 店舗マスタ管理・設定タブ ==================== */}
        {activeTab === 'stores' && (
          <div className="space-y-4">
            <form
              onSubmit={handleSaveStore}
              className="bg-white rounded-2xl p-4 shadow-sm border border-slate-200 space-y-3"
            >
              <h2 className="font-bold text-sm text-slate-900">
                {editingStoreId ? '店舗情報の編集' : '新規店舗の登録'}
              </h2>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  店舗名 <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={storeName}
                  onChange={(e) => setStoreName(e.target.value)}
                  placeholder="例: オーケー 〇〇店"
                  className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  ポイント情報
                </label>
                <input
                  type="text"
                  value={pointInfo}
                  onChange={(e) => setPointInfo(e.target.value)}
                  placeholder="例: 毎週水曜ポイント3倍"
                  className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  お得な支払い方法・決済情報
                </label>
                <input
                  type="text"
                  value={paymentInfo}
                  onChange={(e) => setPaymentInfo(e.target.value)}
                  placeholder="例: 会員カード+現金で3%割引、PayPay可"
                  className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  店舗メモ（営業時間・定休日など）
                </label>
                <input
                  type="text"
                  value={storeMemo}
                  onChange={(e) => setStoreMemo(e.target.value)}
                  placeholder="例: 9:00〜21:30"
                  className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm"
                />
              </div>
              <div className="flex gap-2">
                <button
                  type="submit"
                  className="flex-1 py-2.5 bg-slate-900 text-white font-bold rounded-xl text-xs"
                >
                  {editingStoreId ? '店舗を更新する' : '店舗を追加する'}
                </button>
                {editingStoreId && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingStoreId(null);
                      setStoreName('');
                      setPointInfo('');
                      setPaymentInfo('');
                      setStoreMemo('');
                    }}
                    className="px-4 py-2.5 bg-slate-100 text-slate-600 font-bold rounded-xl text-xs"
                  >
                    キャンセル
                  </button>
                )}
              </div>
            </form>

            <div className="space-y-2.5">
              {stores.map((s) => (
                <div
                  key={s.id}
                  className="bg-white rounded-2xl p-4 shadow-sm border border-slate-200 space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <h3 className="font-bold text-base text-slate-900">{s.name}</h3>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => {
                          setEditingStoreId(s.id);
                          setStoreName(s.name);
                          setPointInfo(s.pointInfo);
                          setPaymentInfo(s.paymentInfo);
                          setStoreMemo(s.memo);
                        }}
                        className="p-1.5 text-slate-500 hover:text-slate-900"
                      >
                        <Edit3 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDeleteStore(s.id)}
                        className="p-1.5 text-slate-400 hover:text-rose-600"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  {s.pointInfo && (
                    <div className="flex items-start gap-2 text-xs text-amber-800 bg-amber-50 px-3 py-1.5 rounded-lg">
                      <Coins className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
                      <span>{s.pointInfo}</span>
                    </div>
                  )}
                  {s.paymentInfo && (
                    <div className="flex items-start gap-2 text-xs text-blue-800 bg-blue-50 px-3 py-1.5 rounded-lg">
                      <CreditCard className="w-4 h-4 shrink-0 mt-0.5 text-blue-600" />
                      <span>{s.paymentInfo}</span>
                    </div>
                  )}
                  {s.memo && <p className="text-xs text-slate-500">{s.memo}</p>}
                </div>
              ))}
            </div>

            <div className="bg-white rounded-2xl p-4 border border-slate-200 flex items-center justify-between">
              <div className="text-xs">
                <p className="text-slate-400">ログイン中</p>
                <p className="font-bold text-slate-700">{user.email}</p>
              </div>
              <button
                onClick={() => signOut(auth)}
                className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold flex items-center gap-1.5"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>ログアウト</span>
              </button>
            </div>
          </div>
        )}
      </main>

      {/* 店舗詳細ポップアップモーダル */}
      {selectedStoreDetail && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
          onClick={() => setSelectedStoreDetail(null)}
        >
          <div
            className="bg-white w-full max-w-sm rounded-2xl p-5 shadow-xl space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
              <h3 className="font-bold text-base text-slate-900">
                {selectedStoreDetail.name}
              </h3>
              <button
                onClick={() => setSelectedStoreDetail(null)}
                className="p-1 text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-2.5 text-xs">
              <div className="p-3 bg-amber-50 text-amber-900 rounded-xl space-y-1">
                <div className="font-bold flex items-center gap-1.5 text-amber-700">
                  <Coins className="w-4 h-4" />
                  <span>ポイント情報</span>
                </div>
                <p>{selectedStoreDetail.pointInfo || '未登録'}</p>
              </div>
              <div className="p-3 bg-blue-50 text-blue-900 rounded-xl space-y-1">
                <div className="font-bold flex items-center gap-1.5 text-blue-700">
                  <CreditCard className="w-4 h-4" />
                  <span>お得な支払い方法</span>
                </div>
                <p>{selectedStoreDetail.paymentInfo || '未登録'}</p>
              </div>
              {selectedStoreDetail.memo && (
                <div className="p-3 bg-slate-50 text-slate-700 rounded-xl">
                  <p className="font-bold mb-0.5 text-slate-500">店舗メモ</p>
                  <p>{selectedStoreDetail.memo}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* バーコードスキャナーモーダル */}
      {scannerTarget && (
        <BarcodeScanner
          onScanSuccess={(code) => {
            if (scannerTarget === 'search') {
              setSearchQuery(code);
            } else if (scannerTarget === 'form') {
              handleJanCodeChange(code);
            }
            setScannerTarget(null);
          }}
          onClose={() => setScannerTarget(null)}
        />
      )}

      {/* 下部固定ナビゲーションバー */}
      <nav className="fixed bottom-0 inset-x-0 z-40 bg-white border-t border-slate-200 pb-safe">
        <div className="max-w-2xl mx-auto grid grid-cols-4 h-16">
          <button
            type="button"
            onClick={() => setActiveTab('compare')}
            className={`flex flex-col items-center justify-center gap-1 text-[11px] font-bold ${
              activeTab === 'compare' ? 'text-emerald-600' : 'text-slate-400'
            }`}
          >
            <Search className="w-5 h-5" />
            <span>検索・比較</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('register')}
            className={`flex flex-col items-center justify-center gap-1 text-[11px] font-bold ${
              activeTab === 'register' ? 'text-emerald-600' : 'text-slate-400'
            }`}
          >
            <PlusCircle className="w-5 h-5" />
            <span>価格登録</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('list')}
            className={`relative flex flex-col items-center justify-center gap-1 text-[11px] font-bold ${
              activeTab === 'list' ? 'text-emerald-600' : 'text-slate-400'
            }`}
          >
            <ShoppingCart className="w-5 h-5" />
            <span>買い物リスト</span>
            {uncompletedListCount > 0 && (
              <span className="absolute top-1.5 right-6 bg-rose-500 text-white text-[10px] font-bold px-1.5 py-0.2 rounded-full">
                {uncompletedListCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('stores')}
            className={`flex flex-col items-center justify-center gap-1 text-[11px] font-bold ${
              activeTab === 'stores' ? 'text-emerald-600' : 'text-slate-400'
            }`}
          >
            <StoreIcon className="w-5 h-5" />
            <span>店舗・設定</span>
          </button>
        </div>
      </nav>
    </div>
  );
}