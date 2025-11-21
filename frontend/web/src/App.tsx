import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';
import { ethers } from 'ethers';

interface CarbonRecord {
  id: number;
  name: string;
  category: string;
  carbonValue: string;
  timestamp: number;
  creator: string;
  publicValue1: number;
  publicValue2: number;
  isVerified?: boolean;
  decryptedValue?: number;
  encryptedValueHandle?: string;
  ecoLevel?: string;
}

interface EcoStats {
  totalFootprint: number;
  ecoScore: number;
  level: string;
  badges: string[];
  weeklyChange: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState<CarbonRecord[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingRecord, setCreatingRecord] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending" as const, 
    message: "" 
  });
  const [newRecordData, setNewRecordData] = useState({ 
    name: "", 
    category: "transport", 
    carbonValue: "" 
  });
  const [selectedRecord, setSelectedRecord] = useState<CarbonRecord | null>(null);
  const [decryptedData, setDecryptedData] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [ecoStats, setEcoStats] = useState<EcoStats>({
    totalFootprint: 0,
    ecoScore: 85,
    level: "绿色先锋",
    badges: ["环保新人", "低碳出行"],
    weeklyChange: -12
  });
  const [showFAQ, setShowFAQ] = useState(false);
  const [operationHistory, setOperationHistory] = useState<string[]>([]);

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting} = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  const addToHistory = (action: string) => {
    setOperationHistory(prev => [
      `${new Date().toLocaleTimeString()}: ${action}`,
      ...prev.slice(0, 9)
    ]);
  };

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected) return;
      if (isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
        addToHistory("FHEVM 系统初始化完成");
      } catch (error) {
        console.error('FHEVM初始化失败:', error);
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM 初始化失败" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('数据加载失败:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const recordsList: CarbonRecord[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          const decryptedValue = Number(businessData.decryptedValue) || 0;
          recordsList.push({
            id: parseInt(businessId.replace('carbon-', '')) || Date.now(),
            name: businessData.name,
            category: businessData.description.includes("交通") ? "transport" : "consumption",
            carbonValue: businessId,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            isVerified: businessData.isVerified,
            decryptedValue: decryptedValue,
            ecoLevel: calculateEcoLevel(decryptedValue)
          });
        } catch (e) {
          console.error('加载碳足迹数据失败:', e);
        }
      }
      
      setRecords(recordsList);
      updateEcoStats(recordsList);
      addToHistory("碳足迹数据加载完成");
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "数据加载失败" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const calculateEcoLevel = (value: number): string => {
    if (value <= 10) return "🌱 环保先锋";
    if (value <= 30) return "💚 绿色达人";
    if (value <= 60) return "🟡 中等水平";
    if (value <= 100) return "🟠 有待改进";
    return "🔴 高碳排放";
  };

  const updateEcoStats = (records: CarbonRecord[]) => {
    const verifiedRecords = records.filter(r => r.isVerified);
    const total = verifiedRecords.reduce((sum, r) => sum + (r.decryptedValue || 0), 0);
    const avg = verifiedRecords.length > 0 ? total / verifiedRecords.length : 0;
    
    let score = 100 - Math.min(100, avg * 2);
    if (score < 0) score = 0;
    
    setEcoStats({
      totalFootprint: total,
      ecoScore: Math.round(score),
      level: calculateEcoLevel(avg),
      badges: getBadges(avg, verifiedRecords.length),
      weeklyChange: -Math.round(avg * 0.1)
    });
  };

  const getBadges = (avg: number, count: number): string[] => {
    const badges = [];
    if (count >= 5) badges.push("数据达人");
    if (avg <= 20) badges.push("低碳先锋");
    if (avg <= 10) badges.push("环保大师");
    if (count >= 10) badges.push("持续记录");
    return badges;
  };

  const createRecord = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "请先连接钱包" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingRecord(true);
    setTransactionStatus({ visible: true, status: "pending", message: "使用 Zama FHE 加密碳足迹数据..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("获取合约失败");
      
      const carbonValue = parseInt(newRecordData.carbonValue) || 0;
      const businessId = `carbon-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, carbonValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newRecordData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        carbonValue,
        0,
        newRecordData.category === "transport" ? "交通碳排放" : "消费碳排放"
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "等待交易确认..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "碳足迹记录创建成功!" });
      addToHistory(`创建记录: ${newRecordData.name}`);
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewRecordData({ name: "", category: "transport", carbonValue: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "用户取消交易" 
        : "提交失败: " + (e.message || "未知错误");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingRecord(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "请先连接钱包" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "数据已链上验证" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "链上验证解密中..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      addToHistory(`解密记录: ${businessId}`);
      
      setTransactionStatus({ visible: true, status: "success", message: "数据解密验证成功!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "数据已链上验证" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        
        await loadData();
        return null;
      }
      
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "解密失败: " + (e.message || "未知错误") 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const callIsAvailable = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const result = await contract.isAvailable();
      setTransactionStatus({ 
        visible: true, 
        status: "success", 
        message: "FHE 系统可用性检查通过!" 
      });
      addToHistory("系统可用性检查");
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "系统检查失败" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const renderEcoDashboard = () => {
    return (
      <div className="dashboard-panels">
        <div className="panel neon-panel">
          <h3>环保等级</h3>
          <div className="stat-value">{ecoStats.level}</div>
          <div className="stat-trend">得分: {ecoStats.ecoScore}</div>
        </div>
        
        <div className="panel neon-panel">
          <h3>总碳足迹</h3>
          <div className="stat-value">{ecoStats.totalFootprint}kg</div>
          <div className="stat-trend">本周: {ecoStats.weeklyChange}kg</div>
        </div>
        
        <div className="panel neon-panel">
          <h3>获得徽章</h3>
          <div className="badges-container">
            {ecoStats.badges.map((badge, index) => (
              <span key={index} className="badge">{badge}</span>
            ))}
          </div>
        </div>
      </div>
    );
  };

  const renderCarbonChart = () => {
    const data = records.filter(r => r.isVerified).slice(0, 7);
    
    return (
      <div className="carbon-chart">
        <h3>近期碳足迹趋势</h3>
        <div className="chart-bars">
          {data.map((record, index) => (
            <div key={index} className="chart-bar-container">
              <div 
                className="chart-bar" 
                style={{ height: `${Math.min(100, (record.decryptedValue || 0) * 2)}%` }}
              >
                <span className="bar-value">{record.decryptedValue}kg</span>
              </div>
              <div className="bar-label">{record.name.substring(0, 4)}</div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderFHEFlow = () => {
    return (
      <div className="fhe-flow">
        <div className="flow-step">
          <div className="step-icon">🔒</div>
          <div className="step-content">
            <h4>数据加密</h4>
            <p>碳足迹数据通过 Zama FHE 加密</p>
          </div>
        </div>
        <div className="flow-arrow">→</div>
        <div className="flow-step">
          <div className="step-icon">⛓️</div>
          <div className="step-content">
            <h4>链上存储</h4>
            <p>加密数据安全存储在区块链上</p>
          </div>
        </div>
        <div className="flow-arrow">→</div>
        <div className="flow-step">
          <div className="step-icon">🔓</div>
          <div className="step-content">
            <h4>隐私解密</h4>
            <p>仅用户可解密查看具体数据</p>
          </div>
        </div>
        <div className="flow-arrow">→</div>
        <div className="flow-step">
          <div className="step-icon">🌱</div>
          <div className="step-content">
            <h4>环保评级</h4>
            <p>公开显示环保等级保护隐私</p>
          </div>
        </div>
      </div>
    );
  };

  const renderFAQ = () => {
    return (
      <div className="faq-section">
        <h3>常见问题</h3>
        <div className="faq-list">
          <div className="faq-item">
            <strong>Q: 我的碳足迹数据安全吗？</strong>
            <p>A: 所有数据都经过 FHE 全同态加密，只有您能解密查看具体数值。</p>
          </div>
          <div className="faq-item">
            <strong>Q: 环保等级如何计算？</strong>
            <p>A: 基于您的加密碳足迹数据计算，不暴露具体生活细节。</p>
          </div>
          <div className="faq-item">
            <strong>Q: 为什么需要验证解密？</strong>
            <p>A: 验证确保数据真实可信，同时保护您的隐私安全。</p>
          </div>
        </div>
      </div>
    );
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>CarbonTrack 🔐</h1>
            <span>隐私碳足迹追踪</span>
          </div>
          <div className="header-actions">
            <div className="wallet-connect-wrapper">
              <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
            </div>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🌍</div>
            <h2>连接钱包开始追踪碳足迹</h2>
            <p>使用 FHE 全同态加密技术，保护您的碳足迹数据隐私</p>
            <div className="connection-steps">
              <div className="step">
                <span>1</span>
                <p>连接您的加密钱包</p>
              </div>
              <div className="step">
                <span>2</span>
                <p>FHE 系统自动初始化</p>
              </div>
              <div className="step">
                <span>3</span>
                <p>开始加密记录碳足迹</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>初始化 FHE 加密系统...</p>
        <p>状态: {fhevmInitializing ? "初始化 FHEVM" : status}</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>加载加密碳足迹系统...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>CarbonTrack 🔐</h1>
          <span>隐私碳足迹追踪</span>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-btn"
          >
            + 记录碳足迹
          </button>
          <button 
            onClick={callIsAvailable}
            className="system-btn"
          >
            系统检查
          </button>
          <button 
            onClick={() => setShowFAQ(!showFAQ)}
            className="faq-btn"
          >
            {showFAQ ? "隐藏FAQ" : "显示FAQ"}
          </button>
          <div className="wallet-connect-wrapper">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </div>
      </header>
      
      <div className="main-content-container">
        <div className="dashboard-section">
          <h2>环保等级仪表盘 (FHE 🔐)</h2>
          {renderEcoDashboard()}
          
          <div className="panel neon-panel full-width">
            <h3>FHE 🔐 隐私保护流程</h3>
            {renderFHEFlow()}
          </div>

          {renderCarbonChart()}
        </div>
        
        <div className="records-section">
          <div className="section-header">
            <h2>碳足迹记录</h2>
            <div className="header-actions">
              <button 
                onClick={loadData} 
                className="refresh-btn" 
                disabled={isRefreshing}
              >
                {isRefreshing ? "刷新中..." : "刷新"}
              </button>
            </div>
          </div>
          
          <div className="records-list">
            {records.length === 0 ? (
              <div className="no-records">
                <p>暂无碳足迹记录</p>
                <button 
                  className="create-btn" 
                  onClick={() => setShowCreateModal(true)}
                >
                  记录第一条足迹
                </button>
              </div>
            ) : records.map((record, index) => (
              <div 
                className={`record-item ${selectedRecord?.id === record.id ? "selected" : ""} ${record.isVerified ? "verified" : ""}`} 
                key={index}
                onClick={() => setSelectedRecord(record)}
              >
                <div className="record-title">
                  {record.name}
                  <span className="eco-level">{record.ecoLevel}</span>
                </div>
                <div className="record-meta">
                  <span>类型: {record.category === "transport" ? "交通" : "消费"}</span>
                  <span>时间: {new Date(record.timestamp * 1000).toLocaleDateString()}</span>
                </div>
                <div className="record-status">
                  状态: {record.isVerified ? "✅ 已验证" : "🔓 待验证"}
                  {record.isVerified && record.decryptedValue && (
                    <span className="verified-amount">碳足迹: {record.decryptedValue}kg</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {showFAQ && (
          <div className="faq-container">
            {renderFAQ()}
          </div>
        )}

        <div className="history-section">
          <h3>操作历史</h3>
          <div className="history-list">
            {operationHistory.map((item, index) => (
              <div key={index} className="history-item">{item}</div>
            ))}
          </div>
        </div>
      </div>
      
      {showCreateModal && (
        <ModalCreateRecord 
          onSubmit={createRecord} 
          onClose={() => setShowCreateModal(false)} 
          creating={creatingRecord} 
          recordData={newRecordData} 
          setRecordData={setNewRecordData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedRecord && (
        <RecordDetailModal 
          record={selectedRecord} 
          onClose={() => { 
            setSelectedRecord(null); 
            setDecryptedData(null); 
          }} 
          decryptedData={decryptedData} 
          setDecryptedData={setDecryptedData} 
          isDecrypting={isDecrypting || fheIsDecrypting} 
          decryptData={() => decryptData(selectedRecord.carbonValue)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && <div className="success-icon">✓</div>}
              {transactionStatus.status === "error" && <div className="error-icon">✗</div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const ModalCreateRecord: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  recordData: any;
  setRecordData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, recordData, setRecordData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    if (name === 'carbonValue') {
      const intValue = value.replace(/[^\d]/g, '');
      setRecordData({ ...recordData, [name]: intValue });
    } else {
      setRecordData({ ...recordData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="create-record-modal">
        <div className="modal-header">
          <h2>记录碳足迹</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE 🔐 加密保护</strong>
            <p>碳足迹数据将使用 Zama FHE 加密 (仅支持整数)</p>
          </div>
          
          <div className="form-group">
            <label>活动名称 *</label>
            <input 
              type="text" 
              name="name" 
              value={recordData.name} 
              onChange={handleChange} 
              placeholder="例如: 开车通勤" 
            />
          </div>
          
          <div className="form-group">
            <label>活动类型 *</label>
            <select name="category" value={recordData.category} onChange={handleChange}>
              <option value="transport">交通出行</option>
              <option value="consumption">消费购物</option>
            </select>
          </div>
          
          <div className="form-group">
            <label>碳足迹值 (kg, 整数) *</label>
            <input 
              type="number" 
              name="carbonValue" 
              value={recordData.carbonValue} 
              onChange={handleChange} 
              placeholder="输入碳足迹数值..." 
              step="1"
              min="0"
            />
            <div className="data-type-label">FHE 加密整数</div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">取消</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !recordData.name || !recordData.carbonValue} 
            className="submit-btn"
          >
            {creating || isEncrypting ? "加密并创建中..." : "创建记录"}
          </button>
        </div>
      </div>
    </div>
  );
};

const RecordDetailModal: React.FC<{
  record: CarbonRecord;
  onClose: () => void;
  decryptedData: number | null;
  setDecryptedData: (value: number | null) => void;
  isDecrypting: boolean;
  decryptData: () => Promise<number | null>;
}> = ({ record, onClose, decryptedData, setDecryptedData, isDecrypting, decryptData }) => {
  const handleDecrypt = async () => {
    if (decryptedData !== null) { 
      setDecryptedData(null); 
      return; 
    }
    
    const decrypted = await decryptData();
    if (decrypted !== null) {
      setDecryptedData(decrypted);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="record-detail-modal">
        <div className="modal-header">
          <h2>碳足迹详情</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="record-info">
            <div className="info-item">
              <span>活动名称:</span>
              <strong>{record.name}</strong>
            </div>
            <div className="info-item">
              <span>创建者:</span>
              <strong>{record.creator.substring(0, 6)}...{record.creator.substring(38)}</strong>
            </div>
            <div className="info-item">
              <span>记录时间:</span>
              <strong>{new Date(record.timestamp * 1000).toLocaleDateString()}</strong>
            </div>
            <div className="info-item">
              <span>活动类型:</span>
              <strong>{record.category === "transport" ? "交通出行" : "消费购物"}</strong>
            </div>
          </div>
          
          <div className="data-section">
            <h3>加密碳足迹数据</h3>
            
            <div className="data-row">
              <div className="data-label">碳足迹值:</div>
              <div className="data-value">
                {record.isVerified && record.decryptedValue ? 
                  `${record.decryptedValue}kg (链上已验证)` : 
                  decryptedData !== null ? 
                  `${decryptedData}kg (本地解密)` : 
                  "🔒 FHE 加密数据"
                }
              </div>
              <button 
                className={`decrypt-btn ${(record.isVerified || decryptedData !== null) ? 'decrypted' : ''}`}
                onClick={handleDecrypt} 
                disabled={isDecrypting}
              >
                {isDecrypting ? (
                  "🔓 验证中..."
                ) : record.isVerified ? (
                  "✅ 已验证"
                ) : decryptedData !== null ? (
                  "🔄 重新验证"
                ) : (
                  "🔓 验证解密"
                )}
              </button>
            </div>
            
            <div className="eco-level-display">
              <h4>环保等级</h4>
              <div className="level-badge">{record.ecoLevel}</div>
              <p>基于加密数据计算的隐私保护评级</p>
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">关闭</button>
          {!record.isVerified && (
            <button 
              onClick={handleDecrypt} 
              disabled={isDecrypting}
              className="verify-btn"
            >
              {isDecrypting ? "链上验证中..." : "链上验证"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;

