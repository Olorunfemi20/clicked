use soroban_sdk::{contracttype, Address, Vec};

#[contracttype]
pub enum DataKey {
    Admin,
    Balances,
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

#[contracttype]
pub struct MemberAddedEvent {
    pub member: Address,
    pub added_by: Address,
}

#[contracttype]
pub struct MemberRemovedEvent {
    pub member: Address,
    pub removed_by: Address,
}