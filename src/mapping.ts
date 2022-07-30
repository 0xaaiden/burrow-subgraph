import { near, log, json, JSONValueKind,JSONValue, BigInt, BigDecimal } from "@graphprotocol/graph-ts";
import { Deposit, Withdraw, Liquidate, DailySnapshotUpdate } from "../generated/schema";
import {
  BIGDECIMAL_ZERO,
  BIGINT_ZERO,
  equalsIgnoreCase,
  exponentToBigDecimal,
  INT_ZERO,
  LendingType,
  Network,
  ProtocolType,
  readValue,
  RiskType,
  USDC_TOKEN_ADDRESS,
  ZERO_ADDRESS,
  ActivityType,
  EventType,
  SECONDS_PER_HOUR,
  SECONDS_PER_DAY,
} from "./constants";

export function handleReceipt(receipt: near.ReceiptWithOutcome): void {
  const actions = receipt.receipt.actions;
  
  for (let i = 0; i < actions.length; i++) {
    handleAction(
      actions[i], 
      receipt.receipt, 
      receipt.block.header,
      receipt.outcome
      );
  }
}

function handleAction(
  action: near.ActionValue,
  receipt: near.ActionReceipt,
  blockHeader: near.BlockHeader,
  outcome: near.ExecutionOutcome
): void {
  
  if (action.kind != near.ActionKind.FUNCTION_CALL) {
    log.info("Early return: {}", ["Not a function call"]);
    return;
  }
  
  // let accounts = new Account(receipt.signerId);
  const functionCall = action.toFunctionCall();
  const methodName = functionCall.methodName
  let depositVal =  BIGINT_ZERO
  let withdrawVal = BIGINT_ZERO
  let liqVal = BIGDECIMAL_ZERO
  const timestamp = BigInt.fromU64(blockHeader.timestampNanosec).div(BigInt.fromI32(1000000000));

  // change the methodName here to the methodName emitting the log in the contract
  if (methodName == "ft_on_transfer") {
    // log.info("found a call ol {}", ["test"]);
    for (let logIndex = 0; logIndex < outcome.logs.length; logIndex++){
      const outcomeLog = outcome.logs[logIndex].toString();

      log.info('outcomeLog {}', [outcomeLog])
      const parsed = outcomeLog.replace('EVENT_JSON:', '')

      const jsonData = json.try_fromString(parsed)
      const jsonObject = jsonData.value.toObject()
      const eventData = jsonObject.get('data')
      const event_called = jsonObject.get("event")
      if(event_called == null) {
        return
      }
      log.info("made it through here {}", ["1"])
      if (eventData && event_called.toString() == "deposit") {
        const receiptId = receipt.id.toHexString();
        const eventArray:JSONValue[] = eventData.toArray()
        log.info("fine {}", ["2"])
        const data = eventArray[0].toObject()
        const account_id = data.get('account_id')
        const token_id = data.get('token_id')
        const amount = data.get('amount')
        let deposit = new Deposit(receiptId);      
        deposit.timestamp = timestamp
        deposit.signerId = receipt.signerId;
        if (amount){
        deposit.amount = BigInt.fromString(amount.toString())

        // Add deposit amount
        depositVal = depositVal.plus(BigInt.fromString(amount.toString()))
       }
        if (token_id){
          deposit.asset = token_id.toString()
        }
        deposit.save()
        
      }
      
      }
  } else if (methodName == "after_ft_transfer") {
    for (let logIndex = 0; logIndex < outcome.logs.length; logIndex++){
      const outcomeLog = outcome.logs[logIndex].toString();

      log.info('outcomeLog {}', [outcomeLog])
      const parsed = outcomeLog.replace('EVENT_JSON:', '')

      const jsonData = json.try_fromString(parsed)
      const jsonObject = jsonData.value.toObject()
      const eventData = jsonObject.get('data')
      const event_called = jsonObject.get("event")
      if(event_called == null) {
        return
      }
      // log.info("made it through here {}", ["1"])
      if (eventData && event_called.toString() == "withdraw_succeeded") {
        const receiptId = receipt.id.toHexString();
        const eventArray:JSONValue[] = eventData.toArray()
        // log.info("fine {}", ["2"])
        const data = eventArray[0].toObject()
        const account_id = data.get('account_id')
        const token_id = data.get('token_id')
        const amount = data.get('amount')
        let withdraw = new Withdraw(receiptId);      
        withdraw.timestamp = BigInt.fromU64(blockHeader.timestampNanosec);
        withdraw.signerId = receipt.signerId;
        if (amount){
          withdraw.amount = BigInt.fromString(amount.toString()) 
        // Add deposit amount
        withdrawVal = withdrawVal.plus(BigInt.fromString(amount.toString())) 
                }
        if (token_id){
          withdraw.asset = token_id.toString()
        }
        withdraw.save()
      }

      }
  } else if (methodName == "oracle_on_call") {
    for (let logIndex = 0; logIndex < outcome.logs.length; logIndex++){
      const outcomeLog = outcome.logs[logIndex].toString();

      log.info('outcomeLog {}', [outcomeLog])
      const parsed = outcomeLog.replace('EVENT_JSON:', '')

      const jsonData = json.try_fromString(parsed)
      const jsonObject = jsonData.value.toObject()
      const eventData = jsonObject.get('data')
      const event_called = jsonObject.get("event")
      if(event_called == null) {
        return
      }
      // log.info("made it through here {}", ["1"])
      if (eventData && event_called.toString() == "liquidate") {
        const receiptId = receipt.id.toHexString();
        const eventArray:JSONValue[] = eventData.toArray()
        log.info("fine {}", ["2"])
        const data = eventArray[0].toObject()
        const account_id = data.get('account_id')
        const liquidatedId = data.get('liquidation_account_id')
        const collateral_sum = data.get('collateral_sum')
        const repaid_sum = data.get('repaid_sum')
        let liquidate = new Liquidate(receiptId);      
        liquidate.timestamp = BigInt.fromU64(blockHeader.timestampNanosec);
        liquidate.signerId = receipt.signerId;
        if (liquidatedId){
          liquidate.liquidatedId = liquidatedId.toString() }
        if (collateral_sum){
          liquidate.collateralSum = BigDecimal.fromString(collateral_sum.toString())
          
          // Add deposit amount
          liqVal = liqVal.plus(BigDecimal.fromString(collateral_sum.toString())) }
        if (repaid_sum){
          liquidate.repaidSum = BigDecimal.fromString(repaid_sum.toString())
        }
        liquidate.save()
      }

      }
  } else {
    log.info("Not processed - FunctionCall is: {}", [functionCall.methodName]);
  }
  updateSnapshot(timestamp, depositVal, withdrawVal, liqVal)
}

function updateSnapshot(timestamp: BigInt, depositVal: BigInt, withdrawVal: BigInt, liqVal: BigDecimal): void {
  const snapshotId = (timestamp.toI32() / SECONDS_PER_DAY).toString()
  let snapshot = DailySnapshotUpdate.load(snapshotId)
  if (!snapshot) {
    snapshot = new DailySnapshotUpdate(snapshotId)
    snapshot.timestamp = timestamp
    snapshot.totalDeposits = BIGINT_ZERO
    snapshot.totalWithdraws = BIGINT_ZERO
    snapshot.totalLiquidate = BIGDECIMAL_ZERO    
  }
  snapshot.totalDeposits = snapshot.totalDeposits.plus(depositVal)
  snapshot.totalWithdraws = snapshot.totalWithdraws.plus(withdrawVal)
  snapshot.totalLiquidate = snapshot.totalLiquidate.plus(liqVal)
  snapshot.save()

}