import React, { useState, useEffect, useRef } from 'react';
import { 
  BatteryCharging, 
  Battery, 
  Plug, 
  Clock, 
  Percent, 
  History, 
  User, 
  Car, 
  Info, 
  Lock, 
  Mail, 
  Zap, 
  Play, 
  Square, 
  LogOut, 
  Sliders,
  AlertTriangle,
  RefreshCw,
  Gauge
} from 'lucide-react';

function App() {
  // Session & UI states
  const [session, setSession] = useState({
    isLoggedIn: false,
    email: '',
    vin: '',
    isDemoMode: true
  });

  const [batteryStatus, setBatteryStatus] = useState({
    batteryLevel: 52,
    batteryAutonomy: 165,
    plugStatus: 1,
    chargingStatus: 0.0,
    chargingRemainingTime: null,
    chargingInstantaneousPower: 0.0,
    batteryTemperature: 20,
    batteryCapacity: 52,
    chargingRateKw: 7.4
  });

  const [schedule, setSchedule] = useState({
    enabled: false,
    startTime: '22:00',
    endTime: '06:00',
    targetSoc: 80
  });

  const [logs, setLogs] = useState([]);

  // Pull to refresh states
  const [startY, setStartY] = useState(null);
  const [pullDistance, setPullDistance] = useState(0);
  const [isPulling, setIsPulling] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Login form states
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isDemoModeToggle, setIsDemoModeToggle] = useState(true);
  const [loginError, setLoginError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isInitialLoading, setIsInitialLoading] = useState(true);

  // Status warnings
  const [warningMessage, setWarningMessage] = useState('');

  // Pour la jauge circulaire
  const circleRadius = 90;
  const strokeWidth = 8;
  const circumference = 2 * Math.PI * circleRadius;
  const batteryLevel = batteryStatus.batteryLevel ?? 0;
  const strokeDashoffset = circumference - (batteryLevel / 100) * circumference;

  // Polling ref
  const pollingRef = useRef(null);

  // Charger le statut initial
  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/vehicle/status');
      const data = await res.json();
      
      if (data.session) {
        setSession(data.session);
      }
      if (data.batteryStatus) {
        setBatteryStatus(data.batteryStatus);
      }
      if (data.warning) {
        setWarningMessage(data.warning);
      } else {
        setWarningMessage('');
      }
    } catch (e) {
      console.error('Erreur de chargement du statut:', e);
    }
  };

  const fetchScheduleAndLogs = async () => {
    try {
      const scheduleRes = await fetch('/api/schedule');
      const scheduleData = await scheduleRes.json();
      setSchedule(scheduleData);

      const logsRes = await fetch('/api/logs');
      const logsData = await logsRes.json();
      setLogs(logsData);
    } catch (e) {
      console.error('Erreur de chargement du planning et des logs:', e);
    }
  };

  // Chargement initial
  useEffect(() => {
    const init = async () => {
      await fetchStatus();
      await fetchScheduleAndLogs();
      setIsInitialLoading(false);
    };
    init();
  }, []);

  // Activer le polling régulier si l'utilisateur est connecté (toutes les 3 secondes)
  useEffect(() => {
    if (session.isLoggedIn) {
      pollingRef.current = setInterval(() => {
        fetchStatus();
        // On récupère aussi les logs régulièrement
        fetch('/api/logs')
          .then(res => res.json())
          .then(data => setLogs(data))
          .catch(e => console.error(e));
      }, 3000);
    } else {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
    }

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
    };
  }, [session.isLoggedIn]);

  // Authentification
  const handleLogin = async (e) => {
    e.preventDefault();
    setLoginError('');
    setIsSubmitting(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password,
          isDemoMode: isDemoModeToggle
        })
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Erreur d\'authentification');
      }

      setSession(data.session);
      await fetchStatus();
      await fetchScheduleAndLogs();
    } catch (err) {
      setLoginError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Déconnexion
  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      setSession({
        isLoggedIn: false,
        email: '',
        vin: '',
        isDemoMode: true
      });
      // Réinitialiser les champs de saisie
      setEmail('');
      setPassword('');
      setIsDemoModeToggle(true);
      await fetchStatus();
      await fetchScheduleAndLogs();
    } catch (e) {
      console.error('Erreur lors de la déconnexion:', e);
    }
  };

  // Envoi de commande manuelle (start/stop charge)
  const handleManualCommand = async (action) => {
    try {
      const res = await fetch('/api/vehicle/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action })
      });
      
      const data = await res.json();
      if (!res.ok) {
        alert(data.error);
      } else {
        await fetchStatus();
        await fetchScheduleAndLogs();
      }
    } catch (e) {
      console.error('Erreur lors de l\'envoi de la commande:', e);
    }
  };

  // Mise à jour de la planification (Schedule)
  const updateSchedule = async (updates) => {
    const newSchedule = { ...schedule, ...updates };
    setSchedule(newSchedule); // Mise à jour locale immédiate de l'interface

    try {
      await fetch('/api/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newSchedule)
      });
      await fetchScheduleAndLogs();
    } catch (e) {
      console.error('Erreur lors de la mise à jour du planning:', e);
    }
  };

  // Mettre à jour l'état simulé (Mode Démo)
  const updateSimulatedState = async (updates) => {
    try {
      const res = await fetch('/api/simulation/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });
      const data = await res.json();
      if (data.success) {
        setBatteryStatus(data.simulation);
        // Rafraîchir les logs
        const logsRes = await fetch('/api/logs');
        const logsData = await logsRes.json();
        setLogs(logsData);
      }
    } catch (e) {
      console.error('Erreur lors de la mise à jour de la simulation:', e);
    }
  };

  // Formatter la date des logs
  const formatLogTime = (isoString) => {
    try {
      const d = new Date(isoString);
      return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch (e) {
      return '';
    }
  };

  // Formatter l'heure de dernière mise à jour
  const formatLastUpdatedTime = (isoString) => {
    if (!isoString) return '--:--:--';
    try {
      const d = new Date(isoString);
      return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch (e) {
      return '--:--:--';
    }
  };

  // Traduire le statut de charge
  const getChargingStatusLabel = () => {
    const status = batteryStatus.chargingStatus;
    if (status === 1.0) return 'En cours de charge';
    if (status === 0.1) return 'Attente Heures Creuses';
    if (status === 0.2) return 'Charge terminée';
    if (status === 0.3) return 'En attente d\'alimentation';
    if (status === 0.4) return 'Trappe ouverte';
    if (status === -1.0) return 'Erreur de charge';
    return 'Arrêtée';
  };

  const handleTouchStart = (e) => {
    const scrollTop = e.currentTarget.scrollTop;
    if (scrollTop === 0) {
      setStartY(e.touches[0].clientY);
      setIsPulling(true);
    }
  };

  const handleTouchMove = (e) => {
    if (startY === null) return;
    const currentY = e.touches[0].clientY;
    const diff = currentY - startY;

    if (diff > 0) {
      // Résistance élastique
      const dist = Math.min(diff * 0.4, 80);
      setPullDistance(dist);
      
      // Empêcher le rebond natif d'iOS
      if (e.cancelable) {
        e.preventDefault();
      }
    }
  };

  const handleTouchEnd = async (e) => {
    if (startY === null) return;
    
    if (pullDistance > 60 && !isRefreshing) {
      setIsRefreshing(true);
      setPullDistance(50); // Garder visible à 50px pendant le chargement
      
      try {
        await fetchStatus();
        await fetchScheduleAndLogs();
      } catch (err) {
        console.error(err);
      } finally {
        setIsRefreshing(false);
        setPullDistance(0);
        setIsPulling(false);
      }
    } else {
      setPullDistance(0);
      setIsPulling(false);
    }
    setStartY(null);
  };

  const isCharging = batteryStatus.chargingStatus === 1.0;
  const isPlugged = batteryStatus.plugStatus === 1;

  if (isInitialLoading) {
    return (
      <div className="app-container" style={{ justifyContent: 'center', alignItems: 'center' }}>
        <RefreshCw size={40} className="charging-bolt" style={{ animation: 'spin 2s linear infinite' }} />
        <p style={{ marginTop: 16, color: 'var(--text-secondary)', fontWeight: 600 }}>Démarrage de SmartCharge...</p>
      </div>
    );
  }

  return (
    <div 
      className="app-container"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Pull to Refresh Indicator */}
      {(pullDistance > 0 || isRefreshing) && (
        <div 
          className="pull-to-refresh-indicator" 
          style={{ 
            height: `${pullDistance}px`, 
            opacity: pullDistance > 10 ? 1 : 0,
            transition: isPulling ? 'none' : 'height 0.3s ease, opacity 0.3s ease'
          }}
        >
          <RefreshCw 
            size={14} 
            className={isRefreshing ? 'spinning' : ''} 
            style={{ 
              transform: isRefreshing ? 'none' : `rotate(${pullDistance * 5}deg)`
            }} 
          />
          <span>
            {isRefreshing 
              ? 'Mise à jour en cours...' 
              : pullDistance > 60 
                ? 'Relâcher pour rafraîchir' 
                : 'Tirer pour rafraîchir'}
          </span>
        </div>
      )}

      {/* HEADER */}
      <header className="app-header">
        <div className="logo-section">
          <h1>SmartCharge</h1>
          <span>Renault Zoe edition</span>
        </div>
        {session.isLoggedIn && (
          <div className={`status-badge ${session.isDemoMode ? 'demo' : 'real'}`}>
            <div className="dot"></div>
            {session.isDemoMode ? 'Mode Démo' : 'Connecté API'}
          </div>
        )}
      </header>

      {/* WARNING BANNER */}
      {warningMessage && (
        <div className="error-banner" style={{ margin: '10px 20px 0 20px' }}>
          <AlertTriangle size={16} style={{ display: 'inline', marginRight: 8, verticalAlign: 'middle' }} />
          {warningMessage}
        </div>
      )}

      {/* MAIN CONTENT */}
      <main className="app-content">
        {!session.isLoggedIn ? (
          // ECRAN DE CONNEXION
          <div className="login-screen">
            <div className="login-header">
              <div className="login-logo">SmartCharge</div>
              <p>Pilotez la recharge de votre Zoe intelligemment</p>
            </div>

            <form className="login-card glass-card" onSubmit={handleLogin}>
              {loginError && <div className="error-banner">{loginError}</div>}

              {/* Toggle Mode Démo */}
              <div className="demo-toggle-row">
                <div className="demo-toggle-label">
                  <span>Utiliser le Mode Démo</span>
                  <span>Simulateur virtuel de Renault Zoe</span>
                </div>
                <label className="ios-switch">
                  <input 
                    type="checkbox" 
                    checked={isDemoModeToggle} 
                    onChange={(e) => setIsDemoModeToggle(e.target.checked)} 
                  />
                  <span className="switch-slider"></span>
                </label>
              </div>

              {!isDemoModeToggle && (
                <>
                  <div className="input-field">
                    <label>Identifiants Renault Connect</label>
                    <input 
                      type="email" 
                      placeholder="Adresse email" 
                      className="ios-text-input"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                  </div>

                  <div className="input-field">
                    <label>Mot de passe</label>
                    <input 
                      type="password" 
                      placeholder="Mot de passe" 
                      className="ios-text-input"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                    />
                  </div>
                </>
              )}

              <button type="submit" className="btn-primary" disabled={isSubmitting}>
                {isSubmitting ? 'Connexion en cours...' : 'Se connecter'}
              </button>
            </form>
          </div>
        ) : (
          // DASHBOARD APRES CONNEXION
          <>
            {/* WIDGET BATTERIE */}
            <div className="glass-card battery-section">
              <div className="battery-circle-container">
                <svg className={`circular-progress ${isCharging ? 'charging' : batteryStatus.batteryLevel < 20 ? 'low' : 'idle'}`} width="200" height="200" viewBox="0 0 200 200" aria-hidden="true">
                  <circle className="bg" cx="100" cy="100" r={circleRadius} />
                  <circle 
                    className="fg" 
                    cx="100" 
                    cy="100" 
                    r={circleRadius} 
                    stroke={isCharging ? 'var(--ios-blue)' : batteryStatus.batteryLevel < 20 ? 'var(--ios-red)' : 'var(--ios-green)'}
                    strokeDasharray={circumference}
                    strokeDashoffset={strokeDashoffset}
                  />
                </svg>
                
                <div className="battery-info">
                  <div className="battery-percentage">
                    {batteryStatus.batteryLevel ?? 0}<span>%</span>
                  </div>
                  <div className="battery-status-text">
                    {isCharging && <Zap size={14} className="charging-bolt" />}
                    {getChargingStatusLabel()}
                  </div>
                </div>
              </div>

              {/* Stats rapides */}
              <div className="stats-grid" style={{ marginTop: 24 }}>
                <div className="stat-item">
                  <div className="stat-icon blue">
                    <Gauge size={18} />
                  </div>
                  <div className="stat-details">
                    <span className="stat-label">Autonomie</span>
                    <span className="stat-value">{batteryStatus.batteryAutonomy ?? 0} km</span>
                  </div>
                </div>

                <div className="stat-item">
                  <div className="stat-icon green">
                    <Plug size={18} />
                  </div>
                  <div className="stat-details">
                    <span className="stat-label">Prise</span>
                    <span className="stat-value">{isPlugged ? 'Branchée' : 'Débranchée'}</span>
                  </div>
                </div>

                <div className="stat-item">
                  <div className="stat-icon orange">
                    <Zap size={18} />
                  </div>
                  <div className="stat-details">
                    <span className="stat-label">Puissance</span>
                    <span className="stat-value">{(batteryStatus.chargingInstantaneousPower ?? 0).toFixed(1)} kW</span>
                  </div>
                </div>

                <div className="stat-item">
                  <div className="stat-icon gray">
                    <Clock size={18} />
                  </div>
                  <div className="stat-details">
                    <span className="stat-label">Temps Restant</span>
                    <span className="stat-value">
                      {isCharging && batteryStatus.chargingRemainingTime 
                        ? `${Math.floor(batteryStatus.chargingRemainingTime / 60)}h ${batteryStatus.chargingRemainingTime % 60}m`
                        : '--'}
                    </span>
                  </div>
                </div>
              </div>
              
              <div className="last-updated-text" style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 14, fontStyle: 'italic', display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'center', width: '100%' }}>
                <Clock size={11} /> Dernière mise à jour : {formatLastUpdatedTime(batteryStatus.lastUpdated)}
              </div>
            </div>

            {/* COMMANDE MANUELLE RAPIDE */}
            <div className="glass-card manual-control-card">
              <div className="control-label">
                <h3>Contrôle Immédiat</h3>
                <p>Forcer ou couper la charge en direct</p>
              </div>
              <div>
                {isCharging ? (
                  <button className="btn-pill stop" onClick={() => handleManualCommand('stop')}>
                    <Square size={14} fill="currentColor" /> Arrêter
                  </button>
                ) : (
                  <button className="btn-pill start" onClick={() => handleManualCommand('start')} disabled={!isPlugged}>
                    <Play size={14} fill="currentColor" /> Démarrer
                  </button>
                )}
              </div>
            </div>

            {/* CONFIGURATION RECHARGE INTELLIGENTE */}
            <div className="glass-card smart-charge-card">
              <div className="card-header-row">
                <div className="card-title-group">
                  <h3>Recharge Intelligente</h3>
                  <p>Charger selon horaires et SoC max</p>
                </div>
                <label className="ios-switch">
                  <input 
                    type="checkbox" 
                    checked={schedule.enabled}
                    onChange={(e) => updateSchedule({ enabled: e.target.checked })}
                  />
                  <span className="switch-slider"></span>
                </label>
              </div>

              {schedule.enabled && (
                <>
                  {/* SoC Cible */}
                  <div className="slider-group">
                    <div className="slider-label-row">
                      <span>Arrêter la charge à</span>
                      <span className="slider-value">{schedule.targetSoc}%</span>
                    </div>
                    <input 
                      type="range" 
                      min="50" 
                      max="100" 
                      step="5"
                      className="ios-range-slider"
                      value={schedule.targetSoc}
                      onChange={(e) => updateSchedule({ targetSoc: Number(e.target.value) })}
                    />
                  </div>

                  {/* Plage Horaire */}
                  <div className="time-picker-row">
                    <div className="time-input-group">
                      <label>Heure Début (Creuses)</label>
                      <input 
                        type="time" 
                        className="ios-time-input"
                        value={schedule.startTime}
                        onChange={(e) => updateSchedule({ startTime: e.target.value })}
                      />
                    </div>
                    <div className="time-input-group">
                      <label>Heure Fin (Plein tarif)</label>
                      <input 
                        type="time" 
                        className="ios-time-input"
                        value={schedule.endTime}
                        onChange={(e) => updateSchedule({ endTime: e.target.value })}
                      />
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* MODE DEMO / SIMULATEUR (Affiché uniquement si session.isDemoMode est actif) */}
            {session.isDemoMode && (
              <div className="glass-card smart-charge-card simulator-panel">
                <h4>
                  <Sliders size={16} /> Contrôles du Simulateur
                </h4>
                <div className="sim-controls-grid">
                  <button 
                    className={`sim-btn ${isPlugged ? 'active' : ''}`}
                    onClick={() => updateSimulatedState({ plugStatus: isPlugged ? 0 : 1 })}
                  >
                    <Plug size={14} /> {isPlugged ? 'Débrancher câble' : 'Brancher câble'}
                  </button>

                  <button 
                    className="sim-btn"
                    onClick={() => updateSimulatedState({ batteryLevel: Math.max(0, batteryStatus.batteryLevel - 10) })}
                  >
                    Retirer -10%
                  </button>

                  <button 
                    className="sim-btn"
                    onClick={() => updateSimulatedState({ batteryLevel: Math.min(100, batteryStatus.batteryLevel + 10) })}
                  >
                    Ajouter +10%
                  </button>

                  <button 
                    className="sim-btn"
                    style={{ fontSize: 10 }}
                    onClick={() => {
                      const nextRate = batteryStatus.chargingRateKw === 7.4 ? 22 : batteryStatus.chargingRateKw === 22 ? 3.7 : 7.4;
                      updateSimulatedState({ chargingRateKw: nextRate });
                    }}
                  >
                    Vitesse: {batteryStatus.chargingRateKw} kW
                  </button>
                </div>
              </div>
            )}

            {/* JOURNAL D'ACTIVITES */}
            <div className="glass-card logs-card">
              <h3>Historique SmartCharge</h3>
              <div className="logs-container">
                {logs.length === 0 ? (
                  <p style={{ fontSize: 12, color: 'var(--text-secondary)', textAlign: 'center', padding: '10px 0' }}>
                    Aucun événement récent.
                  </p>
                ) : (
                  logs.map((log, index) => (
                    <div key={index} className={`log-row ${log.type === 'action' ? 'action' : 'info'}`}>
                      <span className="log-time">{formatLogTime(log.timestamp)}</span>
                      <span className="log-message">{log.message}</span>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* VEHICLE INFO & LOGOUT */}
            <div className="glass-card vehicle-info-card">
              <div className="info-row">
                <span className="info-label">Véhicule</span>
                <span className="info-value">Renault Zoe E-Tech</span>
              </div>
              <div className="info-row">
                <span className="info-label">Châssis (VIN)</span>
                <span className="info-value" style={{ fontFamily: 'monospace', fontSize: 12 }}>
                  {session.vin}
                </span>
              </div>
              {session.email && (
                <div className="info-row">
                  <span className="info-label">Utilisateur</span>
                  <span className="info-value">{session.email}</span>
                </div>
              )}
              
              <button className="logout-button" onClick={handleLogout}>
                <LogOut size={16} /> Se déconnecter
              </button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

export default App;
