#![no_std]

mod storage;
mod token_interface;
mod test;

use soroban_sdk::{contract, contractimpl, Address, Env, Symbol, Map};
use storage::{DataKey, DepositEvent, WithdrawEvent};
use token_interface::TokenClient;

#[contract]
pub struct GroupTreasuryContract;

#[contractimpl]
impl GroupTreasuryContract {
    /// One-time initialisation. Sets the admin and sets up the balances map.
    pub fn initialize(env: Env, admin: Address, _token: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        let balances: Map<Address, i128> = Map::new(&env);
        env.storage().instance().set(&DataKey::Balances, &balances);
    }

    /// Transfer `amount` tokens from `from` into the treasury.
    pub fn deposit(env: Env, from: Address, token: Address, amount: i128) {
        if amount <= 0 {
            panic!("amount must be positive");
        }
        from.require_auth();

        TokenClient::new(&env, &token).transfer(
            &from,
            &env.current_contract_address(),
            &amount,
        );

        let mut balances: Map<Address, i128> = env
            .storage()
            .instance()
            .get(&DataKey::Balances)
            .unwrap_or_else(|| Map::new(&env));

        let current = balances.get(token.clone()).unwrap_or(0);
        balances.set(token.clone(), current + amount);
        env.storage().instance().set(&DataKey::Balances, &balances);

        env.events().publish(
            (Symbol::new(&env, "deposit"),),
            DepositEvent { from, amount },
        );
    }

    /// Admin-only: transfer `amount` tokens from the treasury to `to`.
    pub fn withdraw(env: Env, to: Address, token: Address, amount: i128) {
        if amount <= 0 {
            panic!("amount must be positive");
        }

        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized");
        admin.require_auth();

        let mut balances: Map<Address, i128> = env
            .storage()
            .instance()
            .get(&DataKey::Balances)
            .unwrap_or_else(|| Map::new(&env));

        let current = balances.get(token.clone()).unwrap_or(0);
        if current < amount {
            panic!("insufficient funds");
        }

        TokenClient::new(&env, &token).transfer(
            &env.current_contract_address(),
            &to,
            &amount,
        );

        balances.set(token.clone(), current - amount);
        env.storage().instance().set(&DataKey::Balances, &balances);

        env.events().publish(
            (Symbol::new(&env, "withdraw"),),
            WithdrawEvent { to, amount },
        );
    }

    /// Returns the token balance currently held by this treasury.
    pub fn balance(env: Env, token: Address) -> i128 {
        let balances: Map<Address, i128> = env
            .storage()
            .instance()
            .get(&DataKey::Balances)
            .unwrap_or_else(|| Map::new(&env));

        balances.get(token).unwrap_or(0)
    }
}