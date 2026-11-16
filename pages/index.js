import { useState, useEffect } from 'react';

const SHEET_ID = '1SjQEi48R6AmSVlov5JJ1xkobxEcxPMEe332mkU-3NiA';

// 标准化函数：去掉前后空格，全部转为小写，解决大小写和空格导致的匹配失败
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

const parseDate = (str) => {
  if (!str) return null;
  // 兼容 2026/11/15 和 2026-07-16 两种格式
  const parts = str.replace(/\//g, '-').split('-');
  if (parts.length === 3) {
    return new Date(parts[0], parts[1] - 1, parts[2]).getTime();
  }
  return null;
};

export default function Home() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [summary, setSummary] = useState({ totalProfit: 0, collectProfit: 0, payProfit: 0 });
  const [details, setDetails] = useState([]);

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

      // 通道成本：全部标准化
      const costs = costData.map(row => ({
        channel: normalize(row['通道名称']),
        wallet: normalize(row['钱包/支付方式']),
        collectRate: parseRate(row['通道代收成本率(%)']),
        collectFixed: parseNumber(row['通道代收固定成本(USD/笔)']),
        payRate: parseRate(row['通道代付成本率(%)']),
        payFixed: parseNumber(row['通道代付固定成本(USD/笔)'])
      }));

      // 商户费率：全部标准化
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

      let totalCollectProfit = 0;
      let totalPayProfit = 0;
      const calculatedDetails = dailyData.map(row => {
        const date = row['日期'];
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
        const timestamp = parseDate(date);

        // 算代收
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

        // 算代付
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
            } else if (!mRate || !pCost) {
               // 如果缺配置，不覆盖前面的warnings
            } else {
               warnings.push('代付配置不支持');
            }
          }
        }

        totalCollectProfit += cProfit;
        totalPayProfit += pProfit;

        return {
          date, merchant: row['商户名称'], wallet: row['钱包/支付方式'], cChannel: row['代收通道名称'], cAmount, cCount, pChannel: row['代付通道名称'], pAmount, pCount,
          cProfit: cProfit.toFixed(2),
          pProfit: pProfit.toFixed(2),
          totalRowProfit: (cProfit + pProfit).toFixed(2),
          warnings: Array.from(new Set(warnings)).join(', ')
        };
      });

      setSummary({
        totalProfit: (totalCollectProfit + totalPayProfit).toFixed(2),
        collectProfit: totalCollectProfit.toFixed(2),
        payProfit: totalPayProfit.toFixed(2)
      });
      setDetails(calculatedDetails);
      setError(null);
    } catch (err) {
      setError('获取数据失败，请确保表格已公开。');
    }
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif', backgroundColor: '#f3f4f6', minHeight: '100vh' }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h1 style={{ fontSize: '24px', fontWeight: 'bold' }}>美国支付通道利润统计</h1>
          <button onClick={fetchData} style={{ padding: '10px 20px', backgroundColor: '#2563eb', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer' }}>刷新数据</button>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '50px', fontSize: '18px' }}>数据加载与计算中...</div>
        ) : error ? (
          <div style={{ backgroundColor: '#fee2e2', color: '#b91c1c', padding: '15px', borderRadius: '5px' }}>{error}</div>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px', marginBottom: '30px' }}>
              <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
                <h3 style={{ color: '#6b7280', fontSize: '14px', marginBottom: '10px' }}>总利润 (USD)</h3>
                <p style={{ fontSize: '28px', fontWeight: 'bold', margin: 0 }}>${summary.totalProfit}</p>
              </div>
              <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
                <h3 style={{ color: '#6b7280', fontSize: '14px', marginBottom: '10px' }}>代收利润</h3>
                <p style={{ fontSize: '28px', fontWeight: 'bold', color: '#16a34a', margin: 0 }}>${summary.collectProfit}</p>
              </div>
              <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
                <h3 style={{ color: '#6b7280', fontSize: '14px', marginBottom: '10px' }}>代付利润</h3>
                <p style={{ fontSize: '28px', fontWeight: 'bold', color: '#9333ea', margin: 0 }}>${summary.payProfit}</p>
              </div>
            </div>

            <div style={{ backgroundColor: 'white', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '14px' }}>
                <thead style={{ backgroundColor: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                  <tr>
                    {['日期', '商户', '钱包', '代收通道', '代收量级', '代收利润', '代付通道', '代付量级', '代付利润', '单行总利润', '异常提示'].map(h => (
                      <th key={h} style={{ padding: '12px 16px', color: '#6b7280', fontWeight: '500' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {details.map((row, idx) => (
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
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
