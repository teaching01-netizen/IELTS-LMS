package attempts

import (
 "context"

 "example.com/ielts-proctoring/internal/platform/apperrors"
 "example.com/ielts-proctoring/internal/platform/tx"
)

type canonicalOwners map[string]QuestionOwner

func (owners canonicalOwners) Resolve(_ context.Context, _ tx.Tx, _, questionID string) (QuestionOwner,error) {
 owner,ok:=owners[questionID]
 if !ok {return QuestionOwner{},apperrors.New(apperrors.CodeNotFound,"Question is not part of the pinned attempt exam.")}
 return owner,nil
}

func canonicalizeSATCommand(ctx context.Context,q tx.Tx,cmd SaveResponsesCommand,qr QuestionResolver)(SaveResponsesCommand,QuestionResolver,error){
 canonical,ok:=qr.(CanonicalQuestionResolver)
 if !ok || len(cmd.Commands)==0 {return cmd,qr,nil}
 ids:=make([]string,len(cmd.Commands))
 for i:=range cmd.Commands {ids[i]=cmd.Commands[i].QuestionID}
 owners,err:=canonical.CanonicalizeQuestions(ctx,q,cmd.AttemptID,ids)
 if err!=nil{return cmd,qr,err}
 copied:=false
 for i:=range cmd.Commands {
  owner,ok:=owners[cmd.Commands[i].QuestionID]
  if !ok || owner.CanonicalQuestionID=="" {return cmd,qr,apperrors.New(apperrors.CodeNotFound,"Question is not part of the pinned attempt exam.")}
  if cmd.Commands[i].QuestionID!=owner.CanonicalQuestionID {
   if !copied {cmd.Commands=append([]ResponseCommand(nil),cmd.Commands...);copied=true}
   cmd.Commands[i].QuestionID=owner.CanonicalQuestionID
  }
  owners[owner.CanonicalQuestionID]=owner
 }
 return cmd,canonicalOwners(owners),nil
}
