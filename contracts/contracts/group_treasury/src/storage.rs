use soroban_sdk::{contracttype, Address, Vec};

#[contracttype]
pub enum DataKey {
    Admin,
    TokenContract,
    ProposalsContract,
    Members,
}

#[contracttype]
pub struct DepositEvent {
    pub from: Address,
    pub amount: i128,
}

#[contracttype]
pub struct WithdrawEvent {
    pub to: Address,
    pub amount: i128,
}

pub type MemberList = Vec<Address>;
