#![no_std]

//! Reference Soroban oracle companion contract.
//!
//! This file mirrors the on-chain shape expected by `oracle_interface.rs`:
//! - `verify(payer, amount, invoice_id)` returns the latest oracle judgment.
//! - `get_payer_data(payer)` exposes the cached trust payload.
//! - `set_max_oracle_age(n)` and `get_max_oracle_age()` control freshness.
//!
//! In production the off-chain oracle service would post signed verification
//! results into this contract, and `fund_invoice(..., require_oracle_verification = true)`
//! would consume the cached response inside the same ledger close.

use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, String, Vec};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OracleRequest {
    pub payer: Address,
    pub amount: i128,
    pub invoice_id: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OracleResponse {
    pub payer: Address,
    pub invoice_id: u64,
    pub amount: i128,
    pub trust_score: u32,
    pub confidence: u32,
    pub is_verified: bool,
    pub generated_at_ledger: u32,
    pub response_age_ledgers: u32,
    pub evidence: Vec<String>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
enum DataKey {
    MaxOracleAge,
    CachedResponse(Address, u64),
}

#[contract]
pub struct OracleContract;

#[contractimpl]
impl OracleContract {
    pub fn verify(env: Env, payer: Address, amount: i128, invoice_id: u64) -> OracleResponse {
        let max_age = Self::get_max_oracle_age(env.clone());
        let ledger = env.ledger().sequence();
        let cache_key = DataKey::CachedResponse(payer.clone(), invoice_id);

        let mut response: OracleResponse = env
            .storage()
            .persistent()
            .get(&cache_key)
            .unwrap_or(OracleResponse {
                payer: payer.clone(),
                invoice_id,
                amount,
                trust_score: 0,
                confidence: 0,
                is_verified: false,
                generated_at_ledger: ledger,
                response_age_ledgers: 0,
                evidence: Vec::new(&env),
            });

        response.amount = amount;
        response.invoice_id = invoice_id;
        response.payer = payer;
        response.response_age_ledgers = ledger.saturating_sub(response.generated_at_ledger);

        if max_age != 0 && response.response_age_ledgers > max_age {
            response.is_verified = false;
        }

        response
    }

    pub fn get_payer_data(env: Env, payer: Address) -> Option<OracleResponse> {
        let invoice_id = 0_u64;
        env.storage()
            .persistent()
            .get(&DataKey::CachedResponse(payer, invoice_id))
    }

    pub fn set_payer_data(env: Env, response: OracleResponse) {
        let key = DataKey::CachedResponse(response.payer.clone(), response.invoice_id);
        env.storage().persistent().set(&key, &response);
    }

    pub fn set_max_oracle_age(env: Env, max_age_ledgers: u32) {
        env.storage().persistent().set(&DataKey::MaxOracleAge, &max_age_ledgers);
    }

    pub fn get_max_oracle_age(env: Env) -> u32 {
        env.storage()
            .persistent()
            .get(&DataKey::MaxOracleAge)
            .unwrap_or(0_u32)
    }
}

