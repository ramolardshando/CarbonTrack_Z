import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface CarbonData {
  id: string;
  name: string;
  carbonValue: number;
  category: string;
  timestamp: number;
  creator: string;
  isVerified?: boolean;
  decryptedValue?: number;
  publicValue1: number;
  publicValue2: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [carbonData, setCarbonData] = useState<CarbonData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [addingData, setAddingData] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newData, setNewData] = useState({ name: "", carbonValue: "", category: "transport" });
  const [selectedData, setSelectedData] = useState<CarbonData | null>(null);
  const [decryptedValue, setDecryptedValue] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [environmentLevel, setEnvironmentLevel] = useState("");

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
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
        console.error('Failed to load data:', error);
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
      const dataList: CarbonData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          dataList.push({
            id: businessId,
            name: businessData.name,
            carbonValue: 0,
            category: "carbon",
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setCarbonData(dataList);
      calculateEnvironmentLevel(dataList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const calculateEnvironmentLevel = (data: CarbonData[]) => {
    const totalCarbon = data.reduce((sum, item) => sum + (item.decryptedValue || 0), 0);
    if (totalCarbon === 0) {
      setEnvironmentLevel("🌱 初始环保者");
    } else if (totalCarbon < 100) {
      setEnvironmentLevel("🌿 绿色先锋");
    } else if (totalCarbon < 500) {
      setEnvironmentLevel("🍃 环保达人");
    } else {
      setEnvironmentLevel("🌳 生态卫士");
    }
  };

  const addCarbonData = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "请先连接钱包" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setAddingData(true);
    setTransactionStatus({ visible: true, status: "pending", message: "使用Zama FHE加密碳足迹数据..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("获取合约失败");
      
      const carbonValue = parseInt(newData.carbonValue) || 0;
      const businessId = `carbon-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, carbonValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        0,
        0,
        `碳足迹记录: ${newData.category}`
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "等待交易确认..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "碳足迹数据添加成功!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowAddModal(false);
      setNewData({ name: "", carbonValue: "", category: "transport" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "用户取消交易" 
        : "提交失败: " + (e.message || "未知错误");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setAddingData(false); 
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
        setTransactionStatus({ visible: true, status: "success", message: "数据已在链上验证" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
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
      
      setTransactionStatus({ visible: true, status: "pending", message: "在链上验证解密..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "数据解密验证成功!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ visible: true, status: "success", message: "数据已在链上验证" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        await loadData();
        return null;
      }
      
      setTransactionStatus({ visible: true, status: "error", message: "解密失败: " + (e.message || "未知错误") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      setTransactionStatus({ visible: true, status: "success", message: "系统可用性检查成功!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "可用性检查失败" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const renderStats = () => {
    const totalRecords = carbonData.length;
    const verifiedRecords = carbonData.filter(d => d.isVerified).length;
    const todayRecords = carbonData.filter(d => 
      Date.now()/1000 - d.timestamp < 60 * 60 * 24
    ).length;

    return (
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon">📊</div>
          <div className="stat-content">
            <div className="stat-value">{totalRecords}</div>
            <div className="stat-label">总记录数</div>
          </div>
        </div>
        
        <div className="stat-card">
          <div className="stat-icon">✅</div>
          <div className="stat-content">
            <div className="stat-value">{verifiedRecords}</div>
            <div className="stat-label">已验证数据</div>
          </div>
        </div>
        
        <div className="stat-card">
          <div className="stat-icon">🌱</div>
          <div className="stat-content">
            <div className="stat-value">{todayRecords}</div>
            <div className="stat-label">今日新增</div>
          </div>
        </div>
        
        <div className="stat-card">
          <div className="stat-icon">🏆</div>
          <div className="stat-content">
            <div className="stat-value">{environmentLevel}</div>
            <div className="stat-label">环保等级</div>
          </div>
        </div>
      </div>
    );
  };

  const renderFHEProcess = () => {
    return (
      <div className="fhe-process">
        <div className="process-step">
          <div className="step-number">1</div>
          <div className="step-info">
            <h4>数据加密</h4>
            <p>碳足迹数据使用Zama FHE进行加密保护</p>
          </div>
        </div>
        <div className="process-arrow">→</div>
        <div className="process-step">
          <div className="step-number">2</div>
          <div className="step-info">
            <h4>链上存储</h4>
            <p>加密数据安全存储在区块链上</p>
          </div>
        </div>
        <div className="process-arrow">→</div>
        <div className="process-step">
          <div className="step-number">3</div>
          <div className="step-info">
            <h4>隐私计算</h4>
            <p>在加密状态下进行同态计算</p>
          </div>
        </div>
        <div className="process-arrow">→</div>
        <div className="process-step">
          <div className="step-number">4</div>
          <div className="step-info">
            <h4>安全验证</h4>
            <p>通过零知识证明验证计算结果</p>
          </div>
        </div>
      </div>
    );
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo-section">
            <h1>碳足迹隐私追踪 🔐</h1>
            <p>CarbonTrack - 保护隐私的环保计算</p>
          </div>
          <ConnectButton />
        </header>
        
        <div className="welcome-section">
          <div className="welcome-content">
            <div className="eco-icon">🌍</div>
            <h2>连接钱包开始环保之旅</h2>
            <p>使用全同态加密技术，保护您的碳足迹隐私，展现环保成就</p>
            <div className="feature-list">
              <div className="feature-item">
                <span className="feature-icon">🔒</span>
                <span>数据完全加密</span>
              </div>
              <div className="feature-item">
                <span className="feature-icon">🌱</span>
                <span>隐私保护计算</span>
              </div>
              <div className="feature-item">
                <span className="feature-icon">🏆</span>
                <span>环保等级激励</span>
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
        <div className="spinner"></div>
        <p>初始化FHE加密系统...</p>
        <p className="loading-note">请稍候片刻</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="spinner"></div>
      <p>加载碳足迹数据...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo-section">
          <h1>碳足迹隐私追踪 🔐</h1>
          <p>FHE保护的环保计算平台</p>
        </div>
        
        <div className="header-actions">
          <button onClick={checkAvailability} className="action-btn">
            检查系统状态
          </button>
          <button onClick={() => setShowAddModal(true)} className="primary-btn">
            + 添加碳足迹
          </button>
          <ConnectButton />
        </div>
      </header>

      <main className="main-content">
        <section className="environment-section">
          <h2>您的环保成就</h2>
          {renderStats()}
          
          <div className="fhe-info-panel">
            <h3>FHE隐私保护流程</h3>
            {renderFHEProcess()}
          </div>
        </section>

        <section className="data-section">
          <div className="section-header">
            <h2>碳足迹记录</h2>
            <button onClick={loadData} className="refresh-btn" disabled={isRefreshing}>
              {isRefreshing ? "刷新中..." : "刷新数据"}
            </button>
          </div>
          
          <div className="data-list">
            {carbonData.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">📝</div>
                <p>暂无碳足迹记录</p>
                <button onClick={() => setShowAddModal(true)} className="primary-btn">
                  添加第一条记录
                </button>
              </div>
            ) : (
              carbonData.map((item, index) => (
                <div 
                  key={index} 
                  className={`data-item ${item.isVerified ? 'verified' : ''}`}
                  onClick={() => setSelectedData(item)}
                >
                  <div className="item-main">
                    <div className="item-name">{item.name}</div>
                    <div className="item-meta">
                      <span>{new Date(item.timestamp * 1000).toLocaleDateString()}</span>
                      <span>{item.creator.substring(0, 6)}...{item.creator.substring(38)}</span>
                    </div>
                  </div>
                  <div className="item-status">
                    {item.isVerified ? (
                      <span className="status-verified">✅ 已验证: {item.decryptedValue}克</span>
                    ) : (
                      <span className="status-encrypted">🔒 FHE加密中</span>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </main>

      {showAddModal && (
        <AddDataModal
          onSubmit={addCarbonData}
          onClose={() => setShowAddModal(false)}
          adding={addingData}
          data={newData}
          setData={setNewData}
          isEncrypting={isEncrypting}
        />
      )}

      {selectedData && (
        <DetailModal
          data={selectedData}
          onClose={() => {
            setSelectedData(null);
            setDecryptedValue(null);
          }}
          decryptedValue={decryptedValue}
          isDecrypting={isDecrypting || fheIsDecrypting}
          onDecrypt={() => decryptData(selectedData.id)}
        />
      )}

      {transactionStatus.visible && (
        <div className={`transaction-toast ${transactionStatus.status}`}>
          <div className="toast-content">
            <div className="toast-icon">
              {transactionStatus.status === "pending" && <div className="spinner"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✗"}
            </div>
            <span>{transactionStatus.message}</span>
          </div>
        </div>
      )}
    </div>
  );
};

const AddDataModal: React.FC<{
  onSubmit: () => void;
  onClose: () => void;
  adding: boolean;
  data: any;
  setData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, adding, data, setData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    if (name === 'carbonValue') {
      const intValue = value.replace(/[^\d]/g, '');
      setData({ ...data, [name]: intValue });
    } else {
      setData({ ...data, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-header">
          <h2>添加碳足迹记录</h2>
          <button onClick={onClose} className="close-btn">×</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE隐私保护</strong>
            <p>碳足迹数据将使用Zama FHE进行加密处理</p>
          </div>
          
          <div className="form-group">
            <label>活动名称 *</label>
            <input
              type="text"
              name="name"
              value={data.name}
              onChange={handleChange}
              placeholder="例如: 每日通勤"
            />
          </div>
          
          <div className="form-group">
            <label>碳足迹值(克) *</label>
            <input
              type="number"
              name="carbonValue"
              value={data.carbonValue}
              onChange={handleChange}
              placeholder="输入整数值"
              min="0"
            />
            <div className="input-hint">FHE加密整数</div>
          </div>
          
          <div className="form-group">
            <label>活动类别</label>
            <select name="category" value={data.category} onChange={handleChange}>
              <option value="transport">交通出行</option>
              <option value="diet">饮食消费</option>
              <option value="energy">能源使用</option>
              <option value="shopping">购物消费</option>
            </select>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="secondary-btn">取消</button>
          <button 
            onClick={onSubmit}
            disabled={adding || isEncrypting || !data.name || !data.carbonValue}
            className="primary-btn"
          >
            {adding || isEncrypting ? "加密并提交中..." : "提交记录"}
          </button>
        </div>
      </div>
    </div>
  );
};

const DetailModal: React.FC<{
  data: CarbonData;
  onClose: () => void;
  decryptedValue: number | null;
  isDecrypting: boolean;
  onDecrypt: () => Promise<number | null>;
}> = ({ data, onClose, decryptedValue, isDecrypting, onDecrypt }) => {
  const handleDecrypt = async () => {
    await onDecrypt();
  };

  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-header">
          <h2>碳足迹详情</h2>
          <button onClick={onClose} className="close-btn">×</button>
        </div>
        
        <div className="modal-body">
          <div className="detail-info">
            <div className="info-row">
              <span>活动名称:</span>
              <strong>{data.name}</strong>
            </div>
            <div className="info-row">
              <span>创建者:</span>
              <strong>{data.creator.substring(0, 6)}...{data.creator.substring(38)}</strong>
            </div>
            <div className="info-row">
              <span>创建时间:</span>
              <strong>{new Date(data.timestamp * 1000).toLocaleString()}</strong>
            </div>
          </div>
          
          <div className="data-section">
            <h3>碳足迹数据</h3>
            <div className="carbon-display">
              <div className="carbon-value">
                {data.isVerified ? 
                  `${data.decryptedValue}克 (链上验证)` : 
                  decryptedValue !== null ? 
                  `${decryptedValue}克 (本地解密)` : 
                  "🔒 FHE加密中"
                }
              </div>
              <button 
                onClick={handleDecrypt}
                disabled={isDecrypting}
                className={`decrypt-btn ${data.isVerified ? 'verified' : ''}`}
              >
                {isDecrypting ? "验证中..." : 
                 data.isVerified ? "✅ 已验证" : 
                 decryptedValue !== null ? "🔄 重新验证" : 
                 "🔓 验证解密"}
              </button>
            </div>
            
            <div className="privacy-note">
              <div className="privacy-icon">🔐</div>
              <div>
                <strong>隐私保护说明</strong>
                <p>您的碳足迹数据全程加密处理，仅显示环保等级，不暴露具体生活细节</p>
              </div>
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="secondary-btn">关闭</button>
        </div>
      </div>
    </div>
  );
};

export default App;