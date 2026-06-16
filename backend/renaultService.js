import axios from 'axios';
import 'dotenv/config';

const GIGYA_API_KEY = process.env.GIGYA_API_KEY || '3_VgdkgtIRH3AdHvJm-cjV2ug2EFE0lxt0IJzMC4MFqZjFpn_GYFXVdNZ19L7wZX0N';
const KAMEREON_API_KEY = process.env.KAMEREON_API_KEY || 'YjkKtHmGfaceeuExUDKGxrLZGGvtVS0J';
const GIGYA_URL = process.env.GIGYA_URL || 'https://accounts.eu1.gigya.com';
const KAMEREON_URL = process.env.KAMEREON_URL || 'https://api-wired-prod-1-euw1.wrd-aws.com/commerce/v1';

const renaultApi = axios.create({
  timeout: Number(process.env.RENAULT_API_TIMEOUT_MS || 12000)
});

/**
 * S'authentifie auprès de Gigya (SAP Customer Data Cloud) pour Renault.
 * @param {string} email - Identifiant MyRenault
 * @param {string} password - Mot de passe MyRenault
 * @returns {Promise<{personId: string, jwtToken: string, expiration: number}>}
 */
export async function loginToGigya(email, password) {
  try {
    // Étape 1 : Connexion utilisateur
    const loginResponse = await renaultApi.post(`${GIGYA_URL}/accounts.login`, null, {
      params: {
        apiKey: GIGYA_API_KEY,
        loginID: email,
        password: password,
      }
    });

    if (loginResponse.data.errorCode !== 0) {
      throw new Error(loginResponse.data.errorDetails || 'Échec de connexion Gigya (identifiants invalides).');
    }

    const cookieValue = loginResponse.data.sessionInfo.cookieValue;

    // Étape 2 : Récupérer les informations de compte pour obtenir le personId
    const accountInfoResponse = await renaultApi.post(`${GIGYA_URL}/accounts.getAccountInfo`, null, {
      params: {
        apiKey: GIGYA_API_KEY,
        login_token: cookieValue
      }
    });

    if (accountInfoResponse.data.errorCode !== 0) {
      throw new Error(accountInfoResponse.data.errorDetails || 'Échec de récupération des informations utilisateur.');
    }

    const personId = accountInfoResponse.data.data?.personId;
    if (!personId) {
      throw new Error('Aucun personId trouvé. Assurez-vous que votre compte est configuré sur l\'application MyRenault.');
    }

    // Étape 3 : Récupérer le jeton JWT OIDC pour Kamereon
    const jwtResponse = await renaultApi.post(`${GIGYA_URL}/accounts.getJWT`, null, {
      params: {
        apiKey: GIGYA_API_KEY,
        login_token: cookieValue,
        fields: 'data.personId,data.gigyaDataCenter',
        expiration: 900
      }
    });

    if (jwtResponse.data.errorCode !== 0) {
      throw new Error(jwtResponse.data.errorDetails || 'Impossible d\'obtenir le jeton JWT Kamereon.');
    }

    const jwtToken = jwtResponse.data.id_token;

    return {
      personId,
      jwtToken,
      expiration: Date.now() + 900 * 1000 // Le token expire en général après 15 minutes (900s)
    };
  } catch (error) {
    console.error('Erreur renaultService.loginToGigya:', error.message);
    throw error;
  }
}

/**
 * Récupère l'accountId Kamereon de l'utilisateur.
 * @param {string} jwtToken - Jeton JWT Gigya
 * @param {string} personId - ID de la personne
 * @returns {Promise<string>} - Account ID
 */
export async function getKamereonAccountId(jwtToken, personId) {
  try {
    const response = await renaultApi.get(`${KAMEREON_URL}/persons/${personId}`, {
      params: {
        country: 'FR'
      },
      headers: {
        'apikey': KAMEREON_API_KEY,
        'x-gigya-id_token': jwtToken,
        'Content-Type': 'application/json'
      }
    });

    const accounts = response.data?.accounts || [];
    const myRenaultAccount = accounts.find(acc => acc.accountType === 'MYRENAULT');
    if (!myRenaultAccount) {
      throw new Error('Aucun compte MYRENAULT actif trouvé pour cette personne.');
    }

    return myRenaultAccount.accountId;
  } catch (error) {
    console.error('Erreur renaultService.getKamereonAccountId:', error.message);
    throw error;
  }
}

/**
 * Récupère la liste des véhicules associés au compte.
 * @param {string} jwtToken - Jeton JWT
 * @param {string} accountId - Account ID Kamereon
 * @returns {Promise<Array>} - Liste des véhicules
 */
export async function getVehiclesList(jwtToken, accountId) {
  try {
    const response = await renaultApi.get(`${KAMEREON_URL}/accounts/${accountId}/vehicles`, {
      params: {
        country: 'FR'
      },
      headers: {
        'apikey': KAMEREON_API_KEY,
        'x-gigya-id_token': jwtToken,
        'Content-Type': 'application/json'
      }
    });

    return response.data?.vehicleLinks || [];
  } catch (error) {
    console.error('Erreur renaultService.getVehiclesList:', error.message);
    throw error;
  }
}

/**
 * Interroge l'état de la batterie du véhicule.
 * @param {string} jwtToken - Jeton JWT
 * @param {string} accountId - Account ID
 * @param {string} vin - Numéro de châssis (VIN) de la Zoe
 * @returns {Promise<Object>} - Attributs de batterie
 */
export async function getBatteryStatus(jwtToken, accountId, vin) {
  try {
    const response = await renaultApi.get(`${KAMEREON_URL}/accounts/${accountId}/kamereon/kca/car-adapter/v2/cars/${vin}/battery-status`, {
      params: {
        country: 'FR'
      },
      headers: {
        'apikey': KAMEREON_API_KEY,
        'x-gigya-id_token': jwtToken,
        'Content-Type': 'application/json'
      }
    });

    return response.data?.data?.attributes;
  } catch (error) {
    console.error('Erreur renaultService.getBatteryStatus:', error.message);
    throw error;
  }
}

/**
 * Lance ou arrête la charge du véhicule.
 * @param {string} jwtToken - Jeton JWT
 * @param {string} accountId - Account ID
 * @param {string} vin - VIN du véhicule
 * @param {'start' | 'stop'} action - Action de charge
 * @returns {Promise<Object>} - Réponse de l'action
 */
export async function setChargingAction(jwtToken, accountId, vin, action) {
  try {
    const response = await renaultApi.post(
      `${KAMEREON_URL}/accounts/${accountId}/kamereon/kca/car-adapter/v1/cars/${vin}/actions/charging-start`,
      {
        data: {
          type: 'ChargingStart',
          attributes: {
            action: action // 'start' ou 'stop'
          }
        }
      },
      {
        params: {
          country: 'FR'
        },
        headers: {
          'apikey': KAMEREON_API_KEY,
          'x-gigya-id_token': jwtToken,
          'Content-Type': 'application/vnd.api+json'
        }
      }
    );

    return response.data;
  } catch (error) {
    console.error(`Erreur renaultService.setChargingAction (${action}):`, error.message);
    throw error;
  }
}

/**
 * Récupère la dernière position GPS connue du véhicule.
 * @param {string} jwtToken - Jeton JWT
 * @param {string} accountId - Account ID
 * @param {string} vin - VIN du véhicule
 * @returns {Promise<{gpsLatitude: number, gpsLongitude: number, lastUpdateTime: string}>}
 */
export async function getVehicleLocation(jwtToken, accountId, vin) {
  try {
    const response = await renaultApi.get(`${KAMEREON_URL}/accounts/${accountId}/kamereon/kca/car-adapter/v1/cars/${vin}/location`, {
      params: {
        country: 'FR'
      },
      headers: {
        'apikey': KAMEREON_API_KEY,
        'x-gigya-id_token': jwtToken,
        'Content-Type': 'application/json'
      }
    });

    return response.data?.data?.attributes;
  } catch (error) {
    console.error('Erreur renaultService.getVehicleLocation:', error.message);
    throw error;
  }
}
