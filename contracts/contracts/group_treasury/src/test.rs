#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, Address, Env, Vec};

mod mock_token {
    use soroban_sdk::{contract, contractimpl, contracttype, Address, Env};

    #[contracttype]
    pub enum Key {
        Balance(Address),
    }

    #[contract]
    pub struct MockToken;

    #[contractimpl]
    impl MockToken {
        pub fn mint(env: Env, to: Address, amount: i128) {
            let key = Key::Balance(to);
            let current: i128 = env.storage().persistent().get(&key).unwrap_or(0);
            env.storage().persistent().set(&key, &(current + amount));
        }

        pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
            from.require_auth();
            let from_key = Key::Balance(from.clone());
            let to_key = Key::Balance(to.clone());
            let from_bal: i128 = env.storage().persistent().get(&from_key).unwrap_or(0);
            assert!(from_bal >= amount, "insufficient balance");
            env.storage().persistent().set(&from_key, &(from_bal - amount));
            let to_bal: i128 = env.storage().persistent().get(&to_key).unwrap_or(0);
            env.storage().persistent().set(&to_key, &(to_bal + amount));
        }

        pub fn balance(env: Env, id: Address) -> i128 {
            env.storage()
                .persistent()
                .get(&Key::Balance(id))
                .unwrap_or(0)
        }
    }
}

use mock_token::MockTokenClient;

fn setup(env: &Env) -> (Address, Address, Address, Address, Address) {
    let admin = Address::generate(env);
    let member1 = Address::generate(env);
    let member2 = Address::generate(env);

    let token_id = env.register(mock_token::MockToken, ());
    let token = MockTokenClient::new(env, &token_id);
    token.mint(&member1, &1_000_000);
    token.mint(&member2, &500_000);

    let mut members = Vec::new(env);
    members.push_back(member1.clone());
    members.push_back(member2.clone());

    let treasury_id = env.register(GroupTreasuryContract, ());
    let treasury = GroupTreasuryContractClient::new(env, &treasury_id);
    treasury.initialize(&admin, &token_id, &members);

    (treasury_id, token_id, admin, member1, member2)
}

#[test]
fn test_initialize() {
    let env = Env::default();
    let (treasury_id, _token_id, _admin, member1, member2) = setup(&env);
    let treasury = GroupTreasuryContractClient::new(&env, &treasury_id);
    assert!(treasury.is_member(&member1));
    assert!(treasury.is_member(&member2));
    assert!(!treasury.is_member(&Address::generate(&env)));
}

#[test]
#[should_panic(expected = "already initialized")]
fn test_double_initialize_panics() {
    let env = Env::default();
    let (treasury_id, token_id, admin, member1, _member2) = setup(&env);
    let treasury = GroupTreasuryContractClient::new(&env, &treasury_id);
    let mut members = Vec::new(&env);
    members.push_back(member1);
    treasury.initialize(&admin, &token_id, &members);
}

#[test]
fn test_deposit_and_balance() {
    let env = Env::default();
    env.mock_all_auths();
    let (treasury_id, token_id, _admin, member1, _member2) = setup(&env);
    let treasury = GroupTreasuryContractClient::new(&env, &treasury_id);
    let token = MockTokenClient::new(&env, &token_id);

    assert_eq!(treasury.balance(), 0);
    treasury.deposit(&member1, &300_000);
    assert_eq!(treasury.balance(), 300_000);
    assert_eq!(token.balance(&member1), 700_000);
}

#[test]
#[should_panic(expected = "amount must be positive")]
fn test_deposit_zero_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let (treasury_id, _token_id, _admin, member1, _member2) = setup(&env);
    let treasury = GroupTreasuryContractClient::new(&env, &treasury_id);
    treasury.deposit(&member1, &0);
}

#[test]
fn test_withdraw_by_proposals_contract() {
    let env = Env::default();
    env.mock_all_auths();
    let (treasury_id, token_id, admin, member1, _member2) = setup(&env);
    let treasury = GroupTreasuryContractClient::new(&env, &treasury_id);
    let token = MockTokenClient::new(&env, &token_id);

    treasury.deposit(&member1, &500_000);

    let proposals_contract = Address::generate(&env);
    treasury.set_proposals_contract(&proposals_contract);

    let recipient = Address::generate(&env);
    treasury.withdraw(&recipient, &200_000);

    assert_eq!(treasury.balance(), 300_000);
    assert_eq!(token.balance(&recipient), 200_000);
    let _ = admin;
}

#[test]
#[should_panic(expected = "proposals contract not set")]
fn test_withdraw_without_proposals_contract_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let (treasury_id, _token_id, _admin, member1, _member2) = setup(&env);
    let treasury = GroupTreasuryContractClient::new(&env, &treasury_id);
    treasury.deposit(&member1, &100_000);

    let recipient = Address::generate(&env);
    treasury.withdraw(&recipient, &50_000);
}

#[test]
fn test_get_members() {
    let env = Env::default();
    let (treasury_id, _token_id, _admin, member1, member2) = setup(&env);
    let treasury = GroupTreasuryContractClient::new(&env, &treasury_id);
    let members = treasury.get_members();
    assert_eq!(members.len(), 2);
    assert!(members.contains(&member1));
    assert!(members.contains(&member2));
}
