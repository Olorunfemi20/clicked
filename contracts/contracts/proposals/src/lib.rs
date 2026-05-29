#![no_std]

mod storage;
mod treasury_interface;
mod test;

use soroban_sdk::{contract, contractimpl, Address, Env, String, Symbol};
use storage::{DataKey, Proposal, ProposalCreatedEvent, ProposalExecutedEvent, VoteCastEvent};
use treasury_interface::TreasuryClient;

#[contract]
pub struct ProposalsContract;

#[contractimpl]
impl ProposalsContract {
    pub fn initialize(env: Env, admin: Address, treasury: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Treasury, &treasury);
        env.storage().instance().set(&DataKey::NextId, &0u32);
    }

    /// Create a new proposal. Returns the new proposal ID.
    pub fn create_proposal(
        env: Env,
        proposer: Address,
        description: String,
        amount: i128,
        recipient: Address,
        duration_secs: u64,
    ) -> u32 {
        proposer.require_auth();
        if amount <= 0 {
            panic!("amount must be positive");
        }
        if duration_secs == 0 {
            panic!("duration must be positive");
        }

        let id: u32 = env
            .storage()
            .instance()
            .get(&DataKey::NextId)
            .unwrap_or(0);

        let proposal = Proposal {
            proposer: proposer.clone(),
            description,
            amount,
            recipient,
            yes_votes: 0,
            no_votes: 0,
            end_time: env.ledger().timestamp() + duration_secs,
            executed: false,
        };

        env.storage()
            .persistent()
            .set(&DataKey::Proposal(id), &proposal);
        env.storage()
            .instance()
            .set(&DataKey::NextId, &(id + 1));

        env.events().publish(
            (Symbol::new(&env, "proposal_created"),),
            ProposalCreatedEvent {
                id,
                proposer,
                amount,
            },
        );

        id
    }

    /// Cast a vote on an open proposal.
    /// Panics with "already voted" if the voter has already cast a vote.
    /// Panics with "voting period has ended" if the proposal has expired.
    pub fn cast_vote(env: Env, voter: Address, proposal_id: u32, approve: bool) {
        voter.require_auth();

        let mut proposal: Proposal = env
            .storage()
            .persistent()
            .get(&DataKey::Proposal(proposal_id))
            .expect("proposal not found");

        if env.ledger().timestamp() >= proposal.end_time {
            panic!("voting period has ended");
        }

        let voted: bool = env
            .storage()
            .persistent()
            .get(&DataKey::Voted(proposal_id, voter.clone()))
            .unwrap_or(false);

        if voted {
            panic!("already voted");
        }

        if approve {
            proposal.yes_votes += 1;
        } else {
            proposal.no_votes += 1;
        }

        env.storage()
            .persistent()
            .set(&DataKey::Proposal(proposal_id), &proposal);
        env.storage()
            .persistent()
            .set(&DataKey::Voted(proposal_id, voter.clone()), &true);

        env.events().publish(
            (Symbol::new(&env, "vote_cast"),),
            VoteCastEvent {
                proposal_id,
                voter,
                approve,
            },
        );
    }

    /// Execute a proposal once its voting period has ended.
    /// If yes_votes > no_votes the treasury withdraw is triggered.
    /// Panics if the voting period has not yet ended, or if already executed.
    pub fn execute_proposal(env: Env, proposal_id: u32) {
        let mut proposal: Proposal = env
            .storage()
            .persistent()
            .get(&DataKey::Proposal(proposal_id))
            .expect("proposal not found");

        if env.ledger().timestamp() < proposal.end_time {
            panic!("voting period not yet ended");
        }

        if proposal.executed {
            panic!("proposal already executed");
        }

        proposal.executed = true;
        env.storage()
            .persistent()
            .set(&DataKey::Proposal(proposal_id), &proposal);

        let passed = proposal.yes_votes > proposal.no_votes;

        if passed {
            let treasury: Address = env
                .storage()
                .instance()
                .get(&DataKey::Treasury)
                .expect("not initialized");
            TreasuryClient::new(&env, &treasury).withdraw(&proposal.recipient, &proposal.amount);
        }

        env.events().publish(
            (Symbol::new(&env, "proposal_executed"),),
            ProposalExecutedEvent {
                proposal_id,
                passed,
            },
        );
    }

    pub fn get_proposal(env: Env, proposal_id: u32) -> Proposal {
        env.storage()
            .persistent()
            .get(&DataKey::Proposal(proposal_id))
            .expect("proposal not found")
    }
}
