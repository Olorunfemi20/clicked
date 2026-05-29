#![no_std]

mod storage;
mod token_interface;
mod test;

use soroban_sdk::{contract, contractimpl, Address, Env, Symbol, Vec};
use storage::{DataKey, DepositEvent, MemberList, WithdrawEvent};
use token_interface::TokenClient;

#[contract]
pub struct GroupTreasuryContract;

#[contractimpl]
impl GroupTreasuryContract {
    pub fn initialize(env: Env, admin: Address, token_contract: Address, members: Vec<Address>) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::TokenContract, &token_contract);
        env.storage().instance().set(&DataKey::Members, &members);
    }

    /// Admin-only: authorise the proposals contract to call withdraw.
    pub fn set_proposals_contract(env: Env, proposals_contract: Address) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized");
        admin.require_auth();
        env.storage()
            .instance()
            .set(&DataKey::ProposalsContract, &proposals_contract);
    }

    /// Transfer tokens from `from` into the treasury.
    pub fn deposit(env: Env, from: Address, amount: i128) {
        if amount <= 0 {
            panic!("amount must be positive");
        }
        from.require_auth();
        let token_id: Address = env
            .storage()
            .instance()
            .get(&DataKey::TokenContract)
            .expect("not initialized");
        TokenClient::new(&env, &token_id).transfer(&from, &env.current_contract_address(), &amount);
        env.events()
            .publish((Symbol::new(&env, "deposit"),), DepositEvent { from, amount });
    }

    /// Transfer tokens out of the treasury to `to`.
    /// Only the authorised proposals contract may call this.
    pub fn withdraw(env: Env, to: Address, amount: i128) {
        if amount <= 0 {
            panic!("amount must be positive");
        }
        let proposals: Address = env
            .storage()
            .instance()
            .get(&DataKey::ProposalsContract)
            .expect("proposals contract not set");
        // Satisfied automatically when the proposals contract makes a cross-contract call
        proposals.require_auth();
        let token_id: Address = env
            .storage()
            .instance()
            .get(&DataKey::TokenContract)
            .expect("not initialized");
        TokenClient::new(&env, &token_id).transfer(&env.current_contract_address(), &to, &amount);
        env.events()
            .publish((Symbol::new(&env, "withdraw"),), WithdrawEvent { to, amount });
    }

    pub fn balance(env: Env) -> i128 {
        let token_id: Address = env
            .storage()
            .instance()
            .get(&DataKey::TokenContract)
            .expect("not initialized");
        TokenClient::new(&env, &token_id).balance(&env.current_contract_address())
    }

    pub fn is_member(env: Env, addr: Address) -> bool {
        let members: MemberList = env
            .storage()
            .instance()
            .get(&DataKey::Members)
            .unwrap_or_else(|| Vec::new(&env));
        members.contains(&addr)
    }

    pub fn get_members(env: Env) -> MemberList {
        env.storage()
            .instance()
            .get(&DataKey::Members)
            .unwrap_or_else(|| Vec::new(&env))
    }
}
