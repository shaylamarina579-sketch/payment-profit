import { useState, useEffect, useMemo } from 'react';

const SHEET_ID = '1SjQEi48R6AmSVlov5JJ1xkobxEcxPMEe332mkU-3NiA';

const normalize = (str) => String(str || '').trim().toLowerCase();

const parseCSV = (csvText) => {
  const lines = csvText.split('\n').map(line => {
    const row = [];
    let inQuotes = false;
    let current = '';
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') inQuotes = !inQuotes;
      else if (char === ',' && !inQuotes) {
        row.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    row.push(current);
    return row.map(cell => cell.trim().replace(/^"|"$/g, ''));
  }).filter(row => row.length > 1 && row[0] !== '');

  const headers = lines[0];
  const data = lines.slice(1).map(row => {
    const obj = {};
    headers.forEach((header, index) => {
      obj[header] = row[index] || '';
    });
    return obj;
  });
  return data;
};

const parseRate = (str) => {
  if (!str || str.includes('不支持')) return null;
  const num = parseFloat(str.replace('%', ''));
  return isNaN(num) ? null : num;
};

const parseNumber = (str) => {
  const num = parseFloat(str);
  return isNaN(num) ? 0 : num;
};

// 统一把日期格式化为 YYYY-MM-DD 方便排序和筛选
const formatDate = (str) => {
  if (!str) return '';
  const parts = str.replace(/\//g, '-').split('-');
  if (parts.length === 3) {
    const y = parts[0];
    const m = parts[1].padStart(2, '0');
    const d = parts[2].padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return str;
};

const parseDate = (str) => {
  if (!str) return null;
  const parts = str.replace(/\//g, '-').split('-');
  if (parts.length === 3) {
    return new Date(parts[0], parts[1] - 1, parts[2]).getTime();
  }
  return null;
};

export default function Home() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
  const [rawDetails, setRawDetails] = useState([]);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [viewMode, setViewMode] = useState('summary'); // 'summary' 或 'detail'

  const fetchData = async () => {
    setLoading(true);
    try {
      const [costRes, rateRes, dailyRes] = await Promise.all([
        fetch(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=通道成本表`).then(r => r.text()),
        fetch(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=商户费率配置表`).then(r => r.text()),
        fetch(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=每日交易金额表`).then(r => r.text())
      ]);

      const costData = parseCSV(costRes);
      const rateData = parseCSV(rateRes);
      const dailyData = parseCSV(dailyRes);

      const costs = costData.map(row => ({
        channel: normalize(row['通道名称']),
        wallet: normalize(row['钱包/支付方式']),
        collectRate: parseRate(row['通道代收成本率(%)']),
        collectFixed: parseNumber(row['通道代收固定成本(USD/笔)']),
        payRate: parseRate(row['通道代付成本率(%)']),
        payFixed: parseNumber(row['通道代付固定成本(USD/笔)'])
      }));

      const rates = rateData.map(row => ({
        merchant: normalize(row['商户名称']),
        wallet: normalize(row['钱包/支付方式']),
        channel: normalize(row['通道名称']),
        collectRate: parseRate(row['商户代收费率(%)']),
        collectFixed: parseNumber(row['商户代收固定费(USD/笔)']),
        payRate: parseRate(row['商户代付费率(%)']),
        payFixed: parseNumber(row['商户代付固定费(USD/笔)']),
        startDate: parseDate(row['生效日期']),
        endDate: parseDate(row['失效日期（可空）'])
      }));

      const calculatedDetails = dailyData.map(row => {
        const originalDate = row['日期'];
        const formattedDate = formatDate(originalDate);
        const merchant = normalize(row['商户名称']);
        const wallet = normalize(row['钱包/支付方式']);
        const cChannel = normalize(row['代收通道名称']);
        const cAmount = parseNumber(row['代收金额(USD)']);
        const cCount = parseNumber(row['代收笔数']);
        const pChannel = normalize(row['代付通道名称']);
        const pAmount = parseNumber(row['代付金额(USD)']);
        const pCount = parseNumber(row['代付笔数']);
        
        let cProfit = 0;
        let pProfit = 0;
        let warnings = [];
        const timestamp = parseDate(originalDate);

        if (cAmount > 0 || cCount > 0) {
          const mRate = rates.find(r => r.merchant === merchant && r.wallet === wallet && r.channel === cChannel && (!r.startDate || r.startDate <= timestamp) && (!r.endDate || r.endDate >= timestamp));
          const cCost = costs.find(c => c.channel === cChannel && c.wallet === wallet);

          if (!mRate) warnings.push('缺商户代收费率');
          if (!cCost) warnings.push('缺通道代收成本');

          if (mRate && mRate.collectRate !== null && cCost && cCost.collectRate !== null) {
            const income = (cAmount * mRate.collectRate / 100) + (cCount * mRate.collectFixed);
            const cost = (cAmount * cCost.collectRate / 100) + (cCount * cCost.collectFixed);
            cProfit = income - cost;
          } else if (warnings.length === 0) {
            warnings.push('代收配置不支持');
          }
        }

        if (pAmount > 0 || pCount > 0) {
          if (!pChannel) {
            warnings.push('缺代付通道名称');
          } else {
            const mRate = rates.find(r => r.merchant === merchant && r.wallet === wallet && r.channel === pChannel && (!r.startDate || r.startDate <= timestamp) && (!r.endDate || r.endDate >= timestamp));
            const pCost = costs.find(c => c.channel === pChannel && c.wallet === wallet);

            if (!mRate) warnings.push('缺商户代付费率');
            if (!pCost) warnings.push('缺通道代付成本');

            if (mRate && mRate.payRate !== null && pCost && pCost.payRate !== null) {
              const income = (pAmount * mRate.payRate / 100) + (pCount * mRate.payFixed);
              const cost = (pAmount * pCost.payRate / 100) + (pCount * pCost.payFixed);
              pProfit = income - cost;
            } else if (warnings.length === 0) {
               warnings.push('代付配置不支持');
            }
          }
        }

        return {
          originalDate,
          date: formattedDate,
          merchant: row['商户名称'],
          wallet: row['钱包/支付方式'],
          cChannel: row['代收通道名称'],
          cAmount,
          cCount,
          pChannel: row['代付通道名称'],
          pAmount,
          pCount,
          cProfitRaw: cProfit,
          pProfitRaw: pProfit,
          cProfit: cProfit.toFixed(2),
          pProfit: pProfit.toFixed(2),
          totalRowProfit: (cProfit + pProfit).toFixed(2),
          warnings: Array.from(new Set(warnings)).join(', ')
        };
      });

      // 默认按日期倒序排列，最新的在上面
      calculatedDetails.sort((a, b) => new Date(b.date) - new Date(a.date));
      
      setRawDetails(calculatedDetails);
      
      // 如果有数据，自动设置筛选器的初始日期
      if (calculatedDetails.length > 0) {
        const dates = calculatedDetails.map(d => d.date).sort();
        if (!startDate) setStartDate(dates[0]);
        if (!endDate) setEndDate(dates[dates.length - 1]);
      }

      setError(null);
    } catch (err) {
      setError('获取数据失败，请确保表格已公开。');
    }
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  // 根据日期筛选并计算汇总数据
  const { filteredDetails, dailySummary, summaryTotals } = useMemo(() => {
    let filtered = rawDetails;
    
    // 时间筛选
    if (startDate) {
      filtered = filtered.filter(row => row.date >= startDate);
    }
    if (endDate) {
      filtered = filtered.filter(row => row.date <= endDate);
    }

    // 计算顶部的总卡片数据
    let cTotal = 0;
    let pTotal = 0;
    filtered.forEach(row => {
      cTotal += row.cProfitRaw;
      pTotal += row.pProfitRaw;
    });

    // 按天聚合
    const dailyMap = {};
    filtered.forEach(row => {
      if (!dailyMap[row.date]) {
        dailyMap[row.date] = {
          date: row.date,
          cAmount: 0,
          cCount: 0,
          cProfit: 0,
          pAmount: 0,
          pCount: 0,
          pProfit: 0,
          totalProfit: 0,
          warningsCount: 0
        };
      }
      const d = dailyMap[row.date];
      d.cAmount += row.cAmount;
      d.cCount += row.cCount;
      d.cProfit += row.cProfitRaw;
      d.pAmount += row.pAmount;
      d.pCount += row.pCount;
      d.pProfit += row.pProfitRaw;
      d.totalProfit += (row.cProfitRaw + row.pProfitRaw);
      if (row.warnings) d.warningsCount += 1;
    });

    const summaryArray = Object.values(dailyMap).sort((a, b) => new Date(b.date) - new Date(a.date));

    return {
      filteredDetails: filtered,
      dailySummary: summaryArray,
      summaryTotals: {
        cTotal: cTotal.toFixed(2),
        pTotal: pTotal.toFixed(2),
        total: (cTotal + pTotal).toFixed(2)
      }
    };
  }, [rawDetails, startDate, endDate]);

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif', backgroundColor: '#f3f4f6', minHeight: '100vh' }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
        
        {/* 顶部标题与操作区 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '15px' }}>
          <h1 style={{ fontSize: '24px', fontWeight: 'bold', margin: 0 }}>美国支付通道利润统计</h1>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', backgroundColor: 'white', padding: '5px 10px', borderRadius: '5px', border: '1px solid #d1d5db' }}>
              <span style={{ fontSize: '14px', color: '#6b7280', marginRight: '8px' }}>日期范围:</span>
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={{ border: 'none', outline: 'none', color: '#374151' }} />
              <span style={{ margin: '0 8px', color: '#9ca3af' }}>至</span>
              <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} style={{ border: 'none', outline: 'none', color: '#374151' }} />
            </div>

            <div style={{ display: 'flex', backgroundColor: '#e5e7eb', borderRadius: '5px', padding: '3px' }}>
              <button 
                onClick={() => setViewMode('summary')} 
                style={{ padding: '6px 15px', border: 'none', borderRadius: '4px', cursor: 'pointer', backgroundColor: viewMode === 'summary' ? 'white' : 'transparent', fontWeight: viewMode === 'summary' ? 'bold' : 'normal', boxShadow: viewMode === 'summary' ? '0 1px 2px rgba(0,0,0,0.1)' : 'none' }}
              >按天汇总</button>
              <button 
                onClick={() => setViewMode('detail')} 
                style={{ padding: '6px 15px', border: 'none', borderRadius: '4px', cursor: 'pointer', backgroundColor: viewMode === 'detail' ? 'white' : 'transparent', fontWeight: viewMode === 'detail' ? 'bold' : 'normal', boxShadow: viewMode === 'detail' ? '0 1px 2px rgba(0,0,0,0.1)' : 'none' }}
              >查看明细</button>
            </div>

            <button onClick={fetchData} style={{ padding: '8px 20px', backgroundColor: '#2563eb', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer' }}>刷新数据</button>
          </div>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '50px', fontSize: '18px' }}>数据加载与计算中...</div>
        ) : error ? (
          <div style={{ backgroundColor: '#fee2e2', color: '#b91c1c', padding: '15px', borderRadius: '5px' }}>{error}</div>
        ) : (
          <>
            {/* 顶部汇总卡片 */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px', marginBottom: '30px' }}>
              <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
                <h3 style={{ color: '#6b7280', fontSize: '14px', marginBottom: '10px' }}>筛选期间总利润 (USD)</h3>
                <p style={{ fontSize: '28px', fontWeight: 'bold', margin: 0 }}>${summaryTotals.total}</p>
              </div>
              <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
                <h3 style={{ color: '#6b7280', fontSize: '14px', marginBottom: '10px' }}>代收总利润</h3>
                <p style={{ fontSize: '28px', fontWeight: 'bold', color: '#16a34a', margin: 0 }}>${summaryTotals.cTotal}</p>
              </div>
              <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
                <h3 style={{ color: '#6b7280', fontSize: '14px', marginBottom: '10px' }}>代付总利润</h3>
                <p style={{ fontSize: '28px', fontWeight: 'bold', color: '#9333ea', margin: 0 }}>${summaryTotals.pTotal}</p>
              </div>
            </div>

            {/* 数据表格区 */}
            <div style={{ backgroundColor: 'white', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', overflowX: 'auto' }}>
              
              {/* 按天汇总视图 */}
              {viewMode === 'summary' && (
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '14px' }}>
                  <thead style={{ backgroundColor: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                    <tr>
                      {['日期', '代收总额 (USD)', '代收总笔数', '代收利润', '代付总额 (USD)', '代付总笔数', '代付利润', '当日总利润', '异常项数'].map(h => (
                        <th key={h} style={{ padding: '12px 16px', color: '#6b7280', fontWeight: '500' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {dailySummary.map((row, idx) => (
                      <tr key={idx} style={{ borderBottom: '1px solid #e5e7eb' }}>
                        <td style={{ padding: '12px 16px', fontWeight: 'bold' }}>{row.date}</td>
                        <td style={{ padding: '12px 16px' }}>${row.cAmount.toFixed(2)}</td>
                        <td style={{ padding: '12px 16px', color: '#6b7280' }}>{row.cCount} 笔</td>
                        <td style={{ padding: '12px 16px', color: '#16a34a', fontWeight: '500' }}>${row.cProfit.toFixed(2)}</td>
                        <td style={{ padding: '12px 16px' }}>${row.pAmount.toFixed(2)}</td>
                        <td style={{ padding: '12px 16px', color: '#6b7280' }}>{row.pCount} 笔</td>
                        <td style={{ padding: '12px 16px', color: '#9333ea', fontWeight: '500' }}>${row.pProfit.toFixed(2)}</td>
                        <td style={{ padding: '12px 16px', fontWeight: 'bold', color: row.totalProfit >= 0 ? '#111827' : '#ef4444' }}>${row.totalProfit.toFixed(2)}</td>
                        <td style={{ padding: '12px 16px', color: row.warningsCount > 0 ? '#ef4444' : '#6b7280' }}>{row.warningsCount > 0 ? `${row.warningsCount} 行异常` : '-'}</td>
                      </tr>
                    ))}
                    {dailySummary.length === 0 && (
                      <tr><td colSpan="9" style={{ padding: '20px', textAlign: 'center', color: '#6b7280' }}>当前时间范围内没有数据</td></tr>
                    )}
                  </tbody>
                </table>
              )}

              {/* 明细视图 */}
              {viewMode === 'detail' && (
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '14px' }}>
                  <thead style={{ backgroundColor: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                    <tr>
                      {['日期', '商户', '钱包', '代收通道', '代收量级', '代收利润', '代付通道', '代付量级', '代付利润', '单行总利润', '异常提示'].map(h => (
                        <th key={h} style={{ padding: '12px 16px', color: '#6b7280', fontWeight: '500' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredDetails.map((row, idx) => (
                      <tr key={idx} style={{ borderBottom: '1px solid #e5e7eb' }}>
                        <td style={{ padding: '12px 16px' }}>{row.date}</td>
                        <td style={{ padding: '12px 16px', fontWeight: '500' }}>{row.merchant}</td>
                        <td style={{ padding: '12px 16px', color: '#6b7280' }}>{row.wallet}</td>
                        <td style={{ padding: '12px 16px', color: '#6b7280' }}>{row.cChannel || '-'}</td>
                        <td style={{ padding: '12px 16px', color: '#6b7280' }}>${row.cAmount} / {row.cCount}笔</td>
                        <td style={{ padding: '12px 16px', color: '#16a34a', fontWeight: '500' }}>${row.cProfit}</td>
                        <td style={{ padding: '12px 16px', color: '#6b7280' }}>{row.pChannel || '-'}</td>
                        <td style={{ padding: '12px 16px', color: '#6b7280' }}>${row.pAmount} / {row.pCount}笔</td>
                        <td style={{ padding: '12px 16px', color: '#9333ea', fontWeight: '500' }}>${row.pProfit}</td>
                        <td style={{ padding: '12px 16px', fontWeight: 'bold' }}>${row.totalRowProfit}</td>
                        <td style={{ padding: '12px 16px', color: '#ef4444' }}>{row.warnings || '-'}</td>
                      </tr>
                    ))}
                    {filteredDetails.length === 0 && (
                      <tr><td colSpan="11" style={{ padding: '20px', textAlign: 'center', color: '#6b7280' }}>当前时间范围内没有数据</td></tr>
                    )}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
