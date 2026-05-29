#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::{Address as _, Ledger}, Address, Env, String};

// ── Mock treasury that records withdrawals ────────────────────────────────────

mod mock_treasury {
    use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, Vec};

    #[contracttype]
    pub struct Withdrawal {
        pub to: Address,
        pub amount: i128,
    }

    #[contracttype]
    enum Key {
        History,
    }

    #[contract]
    pub struct MockTreasury;

    #[contractimpl]
    impl MockTreasury {
        pub fn withdraw(env: Env, to: Address, amount: i128) {
            let mut history: Vec<Withdrawal> =
                env.storage().persistent().get(&Key::History).unwrap_or(Vec::new(&env));
            history.push_back(Withdrawal { to, amount });
            env.storage().persistent().set(&Key::History, &history);
        }

        pub fn get_withdrawals(env: Env) -> Vec<Withdrawal> {
            env.storage()
                .persistent()
                .get(&Key::History)
                .unwrap_or(Vec::new(&env))
        }
    }
}

use mock_treasury::{MockTreasuryClient, MockTreasury};

fn setup(env: &Env) -> (Address, Address, Address, Address) {
    let admin = Address::generate(env);
    let treasury_id = env.register(MockTreasury, ());

    let contract_id = env.register(ProposalsContract, ());
    let client = ProposalsContractClient::new(env, &contract_id);
    client.initialize(&admin, &treasury_id);

    let proposer = Address::generate(env);
    let recipient = Address::generate(env);
    (contract_id, treasury_id, proposer, recipient)
}

fn make_proposal(
    env: &Env,
    client: &ProposalsContractClient,
    proposer: &Address,
    recipient: &Address,
    duration_secs: u64,
) -> u32 {
    client.create_proposal(
        proposer,
        &String::from_str(env, "Fund the project"),
        &1_000,
        recipient,
        &duration_secs,
    )
}

#[test]
fn test_initialize() {
    let env = Env::default();
    let (contract_id, _treasury_id, _proposer, _recipient) = setup(&env);
    // Verify initialization does not panic and state is set
    let _ = ProposalsContractClient::new(&env, &contract_id);
}

#[test]
#[should_panic(expected = "already initialized")]
fn test_double_initialize_panics() {
    let env = Env::default();
    let (contract_id, treasury_id, _proposer, _recipient) = setup(&env);
    let client = ProposalsContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin, &treasury_id);
}

#[test]
fn test_create_proposal_returns_id() {
    let env = Env::default();
    env.mock_all_auths();
    let (contract_id, _treasury_id, proposer, recipient) = setup(&env);
    let client = ProposalsContractClient::new(&env, &contract_id);

    let id0 = make_proposal(&env, &client, &proposer, &recipient, 3600);
    let id1 = make_proposal(&env, &client, &proposer, &recipient, 3600);
    assert_eq!(id0, 0);
    assert_eq!(id1, 1);
}

#[test]
fn test_approve_vote_increments_yes() {
    let env = Env::default();
    env.mock_all_auths();
    let (contract_id, _treasury_id, proposer, recipient) = setup(&env);
    let client = ProposalsContractClient::new(&env, &contract_id);

    let id = make_proposal(&env, &client, &proposer, &recipient, 3600);
    let voter = Address::generate(&env);
    client.cast_vote(&voter, &id, &true);

    let p = client.get_proposal(&id);
    assert_eq!(p.yes_votes, 1);
    assert_eq!(p.no_votes, 0);
}

#[test]
fn test_reject_vote_increments_no() {
    let env = Env::default();
    env.mock_all_auths();
    let (contract_id, _treasury_id, proposer, recipient) = setup(&env);
    let client = ProposalsContractClient::new(&env, &contract_id);

    let id = make_proposal(&env, &client, &proposer, &recipient, 3600);
    let voter = Address::generate(&env);
    client.cast_vote(&voter, &id, &false);

    let p = client.get_proposal(&id);
    assert_eq!(p.yes_votes, 0);
    assert_eq!(p.no_votes, 1);
}

#[test]
#[should_panic(expected = "already voted")]
fn test_double_vote_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let (contract_id, _treasury_id, proposer, recipient) = setup(&env);
    let client = ProposalsContractClient::new(&env, &contract_id);

    let id = make_proposal(&env, &client, &proposer, &recipient, 3600);
    let voter = Address::generate(&env);
    client.cast_vote(&voter, &id, &true);
    client.cast_vote(&voter, &id, &true); // second vote panics
}

#[test]
#[should_panic(expected = "voting period has ended")]
fn test_vote_after_expiry_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let (contract_id, _treasury_id, proposer, recipient) = setup(&env);
    let client = ProposalsContractClient::new(&env, &contract_id);

    // Duration of 0 is rejected, so use 1 second then advance the ledger
    let id = make_proposal(&env, &client, &proposer, &recipient, 1);

    // Advance ledger past the end_time
    env.ledger().with_mut(|l| l.timestamp += 10);

    let voter = Address::generate(&env);
    client.cast_vote(&voter, &id, &true);
}

#[test]
fn test_execute_passed_proposal_triggers_treasury_withdraw() {
    let env = Env::default();
    env.mock_all_auths();
    let (contract_id, treasury_id, proposer, recipient) = setup(&env);
    let client = ProposalsContractClient::new(&env, &contract_id);
    let treasury = MockTreasuryClient::new(&env, &treasury_id);

    let id = make_proposal(&env, &client, &proposer, &recipient, 1);

    let voter_a = Address::generate(&env);
    let voter_b = Address::generate(&env);
    client.cast_vote(&voter_a, &id, &true);
    client.cast_vote(&voter_b, &id, &true);

    // Advance past voting period
    env.ledger().with_mut(|l| l.timestamp += 10);

    client.execute_proposal(&id);

    let withdrawals = treasury.get_withdrawals();
    assert_eq!(withdrawals.len(), 1);
    assert_eq!(withdrawals.get(0).unwrap().amount, 1_000);

    let p = client.get_proposal(&id);
    assert!(p.executed);
}

#[test]
fn test_execute_failed_proposal_no_treasury_call() {
    let env = Env::default();
    env.mock_all_auths();
    let (contract_id, treasury_id, proposer, recipient) = setup(&env);
    let client = ProposalsContractClient::new(&env, &contract_id);
    let treasury = MockTreasuryClient::new(&env, &treasury_id);

    let id = make_proposal(&env, &client, &proposer, &recipient, 1);

    // More no votes than yes votes
    client.cast_vote(&Address::generate(&env), &id, &false);
    client.cast_vote(&Address::generate(&env), &id, &false);
    client.cast_vote(&Address::generate(&env), &id, &true);

    env.ledger().with_mut(|l| l.timestamp += 10);

    client.execute_proposal(&id);

    // Treasury should NOT have been called
    assert_eq!(treasury.get_withdrawals().len(), 0);

    let p = client.get_proposal(&id);
    assert!(p.executed);
}

#[test]
#[should_panic(expected = "voting period not yet ended")]
fn test_execute_before_expiry_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let (contract_id, _treasury_id, proposer, recipient) = setup(&env);
    let client = ProposalsContractClient::new(&env, &contract_id);

    let id = make_proposal(&env, &client, &proposer, &recipient, 3600);
    client.execute_proposal(&id); // voting still open
}

#[test]
#[should_panic(expected = "proposal already executed")]
fn test_double_execute_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let (contract_id, _treasury_id, proposer, recipient) = setup(&env);
    let client = ProposalsContractClient::new(&env, &contract_id);

    let id = make_proposal(&env, &client, &proposer, &recipient, 1);
    env.ledger().with_mut(|l| l.timestamp += 10);
    client.execute_proposal(&id);
    client.execute_proposal(&id); // second execution panics
}

#[test]
fn test_tied_vote_does_not_pass() {
    let env = Env::default();
    env.mock_all_auths();
    let (contract_id, treasury_id, proposer, recipient) = setup(&env);
    let client = ProposalsContractClient::new(&env, &contract_id);
    let treasury = MockTreasuryClient::new(&env, &treasury_id);

    let id = make_proposal(&env, &client, &proposer, &recipient, 1);
    client.cast_vote(&Address::generate(&env), &id, &true);
    client.cast_vote(&Address::generate(&env), &id, &false);

    env.ledger().with_mut(|l| l.timestamp += 10);
    client.execute_proposal(&id);

    // Tie means no_votes == yes_votes, so proposal does NOT pass
    assert_eq!(treasury.get_withdrawals().len(), 0);
}

#[test]
fn test_multiple_voters_tally() {
    let env = Env::default();
    env.mock_all_auths();
    let (contract_id, treasury_id, proposer, recipient) = setup(&env);
    let client = ProposalsContractClient::new(&env, &contract_id);
    let treasury = MockTreasuryClient::new(&env, &treasury_id);

    let id = make_proposal(&env, &client, &proposer, &recipient, 1);

    for _ in 0..3 {
        client.cast_vote(&Address::generate(&env), &id, &true);
    }
    for _ in 0..2 {
        client.cast_vote(&Address::generate(&env), &id, &false);
    }

    let p = client.get_proposal(&id);
    assert_eq!(p.yes_votes, 3);
    assert_eq!(p.no_votes, 2);

    env.ledger().with_mut(|l| l.timestamp += 10);
    client.execute_proposal(&id);

    assert_eq!(treasury.get_withdrawals().len(), 1);
}
